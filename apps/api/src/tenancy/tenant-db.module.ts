/**
 * Tenant database access for the api process (M1, issue #64 — the offer
 * store is the first api surface that touches tenant data).
 *
 * The @jenova/db tenant resolver is THE ONLY door to a tenant connection
 * (CLAUDE.md rule 1): this module builds exactly one resolver for the
 * process — control-plane lookup on the configured URL, tenant connections
 * on the least-privilege runtime DSN — and exports its token. Everything is
 * lazy: no database is dialed until the first `getTenantDb` call, so booting
 * with unreachable databases still starts (readiness checks own liveness).
 */

import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import {
  connectControlPlane,
  createTenantDbResolver,
  type ControlPlaneClient,
  type TenantDbResolver,
} from "@jenova/db";
import { API_CONFIG, type ApiConfig } from "../config/config";
import { ConfigModule } from "../config/config.module";

/** Nest injection token for the process-wide {@link TenantDbResolver}. */
export const TENANT_DB_RESOLVER = Symbol("jenova.api.tenantDbResolver");

/**
 * Nest injection token for the process-wide control-plane client — the
 * read path for platform-level data (tenant directory, app installations,
 * supplier catalog, branding). Tenant-operational data NEVER lives behind
 * this token (CLAUDE.md rule 1) — that is the resolver's door.
 */
export const CONTROL_PLANE_CLIENT = Symbol("jenova.api.controlPlaneClient");

/** The resolver plus the control-plane client it reads — closed together. */
interface TenantDbRuntime {
  readonly resolver: TenantDbResolver;
  readonly controlPlane: ControlPlaneClient;
  close(): Promise<void>;
}

const TENANT_DB_RUNTIME = Symbol("jenova.api.tenantDbRuntime");

/** Closes pools on shutdown (enableShutdownHooks in app.factory). */
class TenantDbLifecycle implements OnApplicationShutdown {
  constructor(@Inject(TENANT_DB_RUNTIME) private readonly runtime: TenantDbRuntime) {}

  async onApplicationShutdown(): Promise<void> {
    await this.runtime.close();
  }
}

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: TENANT_DB_RUNTIME,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig): TenantDbRuntime => {
        const controlPlane = connectControlPlane({ url: config.controlPlaneDatabaseUrl });
        const resolver = createTenantDbResolver(controlPlane, {
          runtimeDsn: config.tenantRuntimeDsn,
        });
        return {
          resolver,
          controlPlane,
          close: async () => {
            await resolver.close();
            await controlPlane.close();
          },
        };
      },
    },
    {
      provide: TENANT_DB_RESOLVER,
      inject: [TENANT_DB_RUNTIME],
      useFactory: (runtime: TenantDbRuntime) => runtime.resolver,
    },
    {
      provide: CONTROL_PLANE_CLIENT,
      inject: [TENANT_DB_RUNTIME],
      useFactory: (runtime: TenantDbRuntime) => runtime.controlPlane,
    },
    TenantDbLifecycle,
  ],
  exports: [TENANT_DB_RESOLVER, CONTROL_PLANE_CLIENT],
})
export class TenantDbModule {}
