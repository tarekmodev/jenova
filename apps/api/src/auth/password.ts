/**
 * Password hashing primitive (issue #32; used by login flows from M2+).
 *
 * argon2id via the `argon2` package (pinned exact version — official
 * reference-implementation binding, prebuilt N-API binaries, no JS
 * fallback). Parameters follow the OWASP Password Storage Cheat Sheet
 * baseline: m=19 MiB, t=2, p=1, argon2id. Raising them later is safe —
 * verification reads parameters from the stored PHC string, and
 * {@link passwordNeedsRehash} flags old hashes for upgrade-on-login.
 */

import argon2 from "argon2";

export const ARGON2ID_OPTIONS = {
  type: argon2.argon2id,
  /** KiB — 19 MiB per hash (OWASP baseline for argon2id t=2 p=1). */
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** PHC-format string (`$argon2id$v=19$m=…`) — parameters travel with it. */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2ID_OPTIONS);
}

/**
 * Constant-time verification (inside the native binding). NEVER throws on
 * malformed or foreign hashes — they simply do not verify; a corrupted
 * stored hash must read as "wrong password", not a 500 leaking hash state.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** true ⇒ the stored hash predates current parameters: rehash on next login. */
export function passwordNeedsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, ARGON2ID_OPTIONS);
}
