import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuthModule } from "../auth/auth.module";
import { MACHINE_AUTH, type MachineCredentialVerifier } from "../auth/machine-auth";
import { SESSION_SERVICE, type SessionVerifier } from "../auth/session-service";
import { DenyAllEntitlementSource, ENTITLEMENT_SOURCE, type EntitlementSource } from "./entitlement-source";
import { ErrorEnvelopeFilter } from "./error-envelope.filter";
import { GatewayGuard } from "./gateway.guard";
import { NoopRateLimiter, RATE_LIMITER, type RateLimiter } from "./rate-limiter";
import {
  AuthRealmStage,
  EntitlementStage,
  GATEWAY_PIPELINE,
  GatewayPipeline,
  RateLimitStage,
  TenantResolutionStage,
} from "./stages";
import type { ControlPlaneClient } from "@jenova/db";
import { CONTROL_PLANE_CLIENT, TenantDbModule } from "../tenancy/tenant-db.module";
import { ControlPlaneTenantDirectory } from "./control-plane-tenant-directory";
import { TENANT_DIRECTORY, type TenantDirectory } from "./tenant-directory";

/**
 * Binds the gateway chain into Nest. The tenant directory is control-plane-
 * backed since M2 (#95: `tenant_domain`, migration 0002); the remaining M0
 * defaults (deny-all entitlements, no-op rate limiter, in-memory session and
 * machine-key stores from AuthModule) are replaced via their tokens when
 * their wiring lands — the pipeline assembly below never changes.
 */
@Module({
  imports: [AuthModule, TenantDbModule],
  providers: [
    {
      provide: TENANT_DIRECTORY,
      inject: [CONTROL_PLANE_CLIENT],
      useFactory: (controlPlane: ControlPlaneClient) =>
        new ControlPlaneTenantDirectory(controlPlane),
    },
    { provide: ENTITLEMENT_SOURCE, useClass: DenyAllEntitlementSource },
    { provide: RATE_LIMITER, useClass: NoopRateLimiter },
    {
      provide: GATEWAY_PIPELINE,
      inject: [TENANT_DIRECTORY, SESSION_SERVICE, MACHINE_AUTH, ENTITLEMENT_SOURCE, RATE_LIMITER],
      useFactory: (
        directory: TenantDirectory,
        sessions: SessionVerifier,
        machineKeys: MachineCredentialVerifier,
        entitlements: EntitlementSource,
        limiter: RateLimiter,
      ) =>
        new GatewayPipeline([
          new TenantResolutionStage(directory),
          new AuthRealmStage(sessions, machineKeys),
          new EntitlementStage(entitlements),
          new RateLimitStage(limiter),
        ]),
    },
    { provide: APP_GUARD, useClass: GatewayGuard },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
  ],
  exports: [TENANT_DIRECTORY, ENTITLEMENT_SOURCE, RATE_LIMITER],
})
export class GatewayModule {}
