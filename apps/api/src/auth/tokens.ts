/**
 * Opaque-credential primitives (issue #32; docs/08-security.md).
 *
 * Session credentials are 256-bit random OPAQUE secrets — deliberately not
 * JWTs: interactive realms need instant revocation, which only server-side
 * session records give. The server persists only H(secret); a leaked store
 * dump therefore contains nothing presentable as a credential.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 256 bits of CSPRNG entropy per session secret. */
export const OPAQUE_SECRET_BYTES = 32;

/** New opaque secret, base64url (no padding, no `.` — safe in realm.secret). */
export function generateOpaqueSecret(bytes: number = OPAQUE_SECRET_BYTES): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * SHA-256 hex of a presented secret — the ONLY form that is ever stored,
 * indexed, or logged. A plain (fast) hash is correct here, unlike for
 * passwords: the input already carries 256 bits of CSPRNG entropy, so
 * brute-forcing the preimage is infeasible and a KDF would add nothing.
 */
export function hashOpaqueSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * Constant-time string equality. Never throws on length mismatch (unlike
 * raw `timingSafeEqual`); comparison time is independent of the CONTENT of
 * either input. Input length is not hidden — credential lengths are public
 * shape, not secret material.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Burn a comparison anyway so the mismatch path costs the same.
    timingSafeEqual(bufB, bufB);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
