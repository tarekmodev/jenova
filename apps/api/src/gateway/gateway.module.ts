import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import type { ControlPlaneClient } from "@jenova/db";
import { AuthModule } from "../auth/auth.module";
import { MACHINE_AUTH, type MachineCredentialVerifier } from "../auth/machine-auth";
import { SESSION_SERVICE, type SessionVerifier } from "../auth/session-service";
import {
  ControlPlaneEntitlementSource,
  ControlPlaneTenantDirectory,
} from "../tenancy/control-plane-directory";
import { CONTROL_PLANE_CLIENT, TenantDbModule } from "../tenancy/tenant-db.module";
import { ENTITLEMENT_SOURCE, type EntitlementSource } from "./entitlement-source";
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
import { TENANT_DIRECTORY, type TenantDirectory } from "./tenant-directory";

/**
 * Binds the gateway chain into Nest. Tenant resolution reads the
 * control-plane tenant_host table (the "post-#42 wiring" the M0 stub
 * promised); the remaining M0 defaults (deny-all entitlements, no-op rate
 * limiter, in-memory session and machine-key stores from AuthModule) are
 * replaced via their tokens as their wiring lands — the pipeline assembly
 * below never changes.
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
    {
      // @RequiresApp routes check the same AppInstallation flags the
      // dashboard's nav reads — the api refuses what the UI merely hides.
      provide: ENTITLEMENT_SOURCE,
      inject: [CONTROL_PLANE_CLIENT],
      useFactory: (controlPlane: ControlPlaneClient) =>
        new ControlPlaneEntitlementSource(controlPlane),
    },
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
