/**
 * Machine-realm key + HMAC auth skeleton (issue #32; docs/08-security.md:
 * "Machine | Partner API | Key + HMAC; scoped to tenant or sub-tenant").
 *
 * Machines do not get sessions — nothing to idle out, revocation is key
 * revocation. The credential the gateway hands over (after stripping the
 * `machine.` realm tag) is `<keyId>.<unixSeconds>.<signature>` where the
 * signature is HMAC-SHA256 over {@link machineStringToSign}.
 *
 * M0 SKELETON boundary: the signature binds key id + timestamp only.
 * Request binding (method, path, body hash), per-key quotas, and metering
 * land with the API Access app — the credential wire shape and this
 * verifier's contract do not change.
 */

import { createHmac } from "node:crypto";
import type { SubTenantId, TenantId } from "@jenova/domain";
import type { VerifiedMachineAuth } from "../gateway/request-context";
import { constantTimeEquals } from "./tokens";

/** Accepted clock skew between signer and verifier (replay containment). */
export const MACHINE_TIMESTAMP_SKEW_MS = 5 * 60_000;

export interface MachineKeyRecord {
  readonly keyId: string;
  /**
   * Shared HMAC secret — held raw here because HMAC verification needs the
   * bytes. At-rest encryption (per-tenant data key, KMS-wrapped, docs/08)
   * is the db-backed store's concern when the API Access app lands.
   */
  readonly secret: string;
  /** Machine keys are ALWAYS tenant-scoped. */
  readonly tenantId: TenantId;
  readonly subTenantId: SubTenantId | null;
  readonly revoked: boolean;
}

export interface MachineKeyStore {
  getKey(keyId: string): Promise<MachineKeyRecord | null>;
}

/** Nest injection token for the process-wide {@link MachineKeyStore}. */
export const MACHINE_KEY_STORE = Symbol("jenova.api.machineKeyStore");

/** M0 default: empty per-process key store; db-backed store binds later. */
export class InMemoryMachineKeyStore implements MachineKeyStore {
  private readonly keys = new Map<string, MachineKeyRecord>();

  putKey(record: MachineKeyRecord): void {
    this.keys.set(record.keyId, record);
  }

  getKey(keyId: string): Promise<MachineKeyRecord | null> {
    return Promise.resolve(this.keys.get(keyId) ?? null);
  }
}

/** The exact bytes the HMAC covers. Versioned by shape, shared with signers. */
export function machineStringToSign(keyId: string, timestampSeconds: number): string {
  return `machine.${keyId}.${String(timestampSeconds)}`;
}

/**
 * Produce a full machine credential (`<keyId>.<ts>.<sig>`) for a key —
 * the partner-SDK signing half, used by tests and the future SDK.
 */
export function signMachineCredential(
  keyId: string,
  secret: string,
  timestampSeconds: number,
): string {
  const signature = createHmac("sha256", secret)
    .update(machineStringToSign(keyId, timestampSeconds), "utf8")
    .digest("base64url");
  return `${keyId}.${String(timestampSeconds)}.${signature}`;
}

export type MachineRejectionReason =
  | "malformed"
  | "unknown_key"
  | "revoked_key"
  | "stale_timestamp"
  | "bad_signature"
  | "tenant_mismatch";

export type MachineVerification =
  | { readonly ok: true; readonly auth: VerifiedMachineAuth }
  | { readonly ok: false; readonly reason: MachineRejectionReason };

/** What the gateway's auth stage needs — the service implements it. */
export interface MachineCredentialVerifier {
  verifyMachineCredential(
    credential: string,
    expectedTenantId: TenantId | null,
  ): Promise<MachineVerification>;
}

export interface MachineAuthServiceOptions {
  readonly clock?: () => number;
  readonly skewMs?: number;
}

/** Nest injection token for the process-wide {@link MachineAuthService}. */
export const MACHINE_AUTH = Symbol("jenova.api.machineAuth");

export class MachineAuthService implements MachineCredentialVerifier {
  private readonly clock: () => number;
  private readonly skewMs: number;

  constructor(
    private readonly keys: MachineKeyStore,
    options: MachineAuthServiceOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.skewMs = options.skewMs ?? MACHINE_TIMESTAMP_SKEW_MS;
  }

  async verifyMachineCredential(
    credential: string,
    expectedTenantId: TenantId | null,
  ): Promise<MachineVerification> {
    const parts = credential.split(".");
    if (parts.length !== 3) {
      return { ok: false, reason: "malformed" };
    }
    const [keyId, timestampText, signature] = parts as [string, string, string];
    if (keyId.length === 0 || signature.length === 0 || !/^\d{1,12}$/.test(timestampText)) {
      return { ok: false, reason: "malformed" };
    }
    const timestampSeconds = Number(timestampText);

    const key = await this.keys.getKey(keyId);
    if (key === null) {
      // Burn an HMAC anyway so unknown key ids cost the same as bad
      // signatures — no key-enumeration timing oracle.
      createHmac("sha256", "jenova-unknown-key-equalizer")
        .update(machineStringToSign(keyId, timestampSeconds), "utf8")
        .digest();
      return { ok: false, reason: "unknown_key" };
    }
    if (key.revoked) {
      return { ok: false, reason: "revoked_key" };
    }
    if (Math.abs(this.clock() - timestampSeconds * 1000) > this.skewMs) {
      return { ok: false, reason: "stale_timestamp" };
    }
    const expected = createHmac("sha256", key.secret)
      .update(machineStringToSign(keyId, timestampSeconds), "utf8")
      .digest("base64url");
    if (!constantTimeEquals(signature, expected)) {
      return { ok: false, reason: "bad_signature" };
    }
    if (expectedTenantId === null || key.tenantId !== expectedTenantId) {
      // Keys are tenant-scoped; a key from tenant A is dead on tenant B's
      // host, and with no resolved tenant there is nothing to scope to.
      return { ok: false, reason: "tenant_mismatch" };
    }
    return {
      ok: true,
      auth: {
        state: "verified",
        realm: "machine",
        principal: {
          realm: "machine",
          keyId: key.keyId,
          tenantId: key.tenantId,
          subTenantId: key.subTenantId,
        },
      },
    };
  }
}
