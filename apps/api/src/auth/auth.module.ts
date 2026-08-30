/**
 * Auth module (issues #32/#33, M2 #89): realm-bound sessions, machine-key
 * HMAC verification, the credential primitives (argon2id passwords, TOTP,
 * recovery codes), and — since M2 — the tenant-staff login/TOTP endpoints
 * for the Internal Dashboard, kept exactly on those M0 primitives.
 *
 * The in-memory session/machine-key/TOTP-replay stores are per-process;
 * redis/db-backed stores bind to their tokens later — services, endpoints
 * and the gateway wiring stay put.
 */

import { Module } from "@nestjs/common";
import type { ControlPlaneClient, TenantDbResolver } from "@jenova/db";
import { ConfigModule } from "../config/config.module";
import { ControlPlaneEntitlementSource } from "../tenancy/control-plane-directory";
import { SECRET_BOX, type SecretBox } from "../tenancy/secret-box";
import {
  CONTROL_PLANE_CLIENT,
  TENANT_DB_RESOLVER,
  TenantDbModule,
} from "../tenancy/tenant-db.module";
import {
  InMemoryMachineKeyStore,
  MACHINE_AUTH,
  MACHINE_KEY_STORE,
  MachineAuthService,
  type MachineKeyStore,
} from "./machine-auth";
import { SESSION_SERVICE, SessionService } from "./session-service";
import { InMemorySessionStore, SESSION_STORE, type SessionStore } from "./session-store";
import { ENTITLEMENT_READER, MeController } from "./me.controller";
import { StaffAuthController } from "./staff-auth.controller";
import { STAFF_AUTH_SERVICE, StaffAuthService } from "./staff-auth.service";
import { DrizzleStaffUserStore, STAFF_USER_STORE, type StaffUserStore } from "./staff-users";
import {
  InMemoryTotpReplayStore,
  TOTP_REPLAY_STORE,
  TotpVerifier,
  type TotpReplayStore,
} from "./totp";

/** Nest injection token for the process-wide {@link TotpVerifier}. */
export const TOTP_VERIFIER = Symbol("jenova.api.totpVerifier");

@Module({
  imports: [ConfigModule, TenantDbModule],
  controllers: [StaffAuthController, MeController],
  providers: [
    { provide: SESSION_STORE, useClass: InMemorySessionStore },
    {
      provide: SESSION_SERVICE,
      inject: [SESSION_STORE],
      useFactory: (store: SessionStore) => new SessionService(store),
    },
    { provide: MACHINE_KEY_STORE, useClass: InMemoryMachineKeyStore },
    {
      provide: MACHINE_AUTH,
      inject: [MACHINE_KEY_STORE],
      useFactory: (keys: MachineKeyStore) => new MachineAuthService(keys),
    },
    { provide: TOTP_REPLAY_STORE, useClass: InMemoryTotpReplayStore },
    {
      provide: TOTP_VERIFIER,
      inject: [TOTP_REPLAY_STORE],
      useFactory: (replay: TotpReplayStore) => new TotpVerifier(replay),
    },
    {
      provide: STAFF_USER_STORE,
      inject: [TENANT_DB_RESOLVER],
      useFactory: (resolver: TenantDbResolver) => new DrizzleStaffUserStore(resolver),
    },
    {
      provide: ENTITLEMENT_READER,
      inject: [CONTROL_PLANE_CLIENT],
      useFactory: (controlPlane: ControlPlaneClient) =>
        new ControlPlaneEntitlementSource(controlPlane),
    },
    {
      provide: STAFF_AUTH_SERVICE,
      inject: [STAFF_USER_STORE, SESSION_SERVICE, TOTP_VERIFIER, SECRET_BOX],
      useFactory: (
        store: StaffUserStore,
        sessions: SessionService,
        totp: TotpVerifier,
        secrets: SecretBox,
      ) => new StaffAuthService(store, sessions, totp, secrets),
    },
  ],
  exports: [
    SESSION_STORE,
    SESSION_SERVICE,
    MACHINE_KEY_STORE,
    MACHINE_AUTH,
    TOTP_REPLAY_STORE,
    TOTP_VERIFIER,
    STAFF_USER_STORE,
    STAFF_AUTH_SERVICE,
    ENTITLEMENT_READER,
  ],
})
export class AuthModule {}
