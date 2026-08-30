/**
 * Auth module (issues #32/#33): realm-bound sessions, machine-key HMAC
 * verification, and the credential primitives (argon2id passwords, TOTP,
 * recovery codes — pure functions, no providers needed).
 *
 * The two M0 in-memory stores are per-process and empty at boot — nothing
 * interactive ships yet. Redis/db-backed stores bind to SESSION_STORE /
 * MACHINE_KEY_STORE later; the services and the gateway wiring stay put.
 */

import { Module } from "@nestjs/common";
import {
  InMemoryMachineKeyStore,
  MACHINE_AUTH,
  MACHINE_KEY_STORE,
  MachineAuthService,
  type MachineKeyStore,
} from "./machine-auth";
import { SESSION_SERVICE, SessionService } from "./session-service";
import { InMemorySessionStore, SESSION_STORE, type SessionStore } from "./session-store";

@Module({
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
  ],
  exports: [SESSION_STORE, SESSION_SERVICE, MACHINE_KEY_STORE, MACHINE_AUTH],
})
export class AuthModule {}
