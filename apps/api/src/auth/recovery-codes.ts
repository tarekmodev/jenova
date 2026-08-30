/**
 * One-time recovery codes for 2FA account recovery (issue #33).
 *
 * Each code carries 80 bits of CSPRNG entropy, so SHA-256 at rest is
 * cryptographically sufficient (unlike user-chosen passwords, there is no
 * guessable distribution for a KDF to defend) — the same reasoning as
 * session-token hashing in ./tokens. Plaintext codes exist exactly once,
 * in the generation result handed to the user; only hashes persist.
 */

import { randomBytes } from "node:crypto";
import { base32Encode } from "./totp";
import { constantTimeEquals, hashOpaqueSecret } from "./tokens";

export const RECOVERY_CODE_COUNT = 10;

/** 10 bytes → 16 base32 chars → 80 bits per code. */
const RECOVERY_CODE_BYTES = 10;

/** Canonical form: uppercase base32 in dash-separated groups of four. */
function formatRecoveryCode(raw: string): string {
  return raw.match(/.{4}/g)?.join("-") ?? raw;
}

/** Hashing input: separators and case stripped, so retyping variants match. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, "");
}

export function hashRecoveryCode(code: string): string {
  return hashOpaqueSecret(normalizeRecoveryCode(code));
}

export interface GeneratedRecoveryCodes {
  /** Plaintext, e.g. `A2CD-EFGH-IJKL-MNOP` — shown ONCE, never stored. */
  readonly codes: readonly string[];
  /** SHA-256 hex per code — the only thing persisted, index-aligned. */
  readonly hashes: readonly string[];
}

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): GeneratedRecoveryCodes {
  const codes = Array.from({ length: count }, () =>
    formatRecoveryCode(base32Encode(randomBytes(RECOVERY_CODE_BYTES))),
  );
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

export interface RecoveryCodeSetState {
  readonly hashes: readonly string[];
  /** Index-aligned with hashes; true = burned. */
  readonly consumed: readonly boolean[];
}

/**
 * Single-use consumption over hashed-at-rest codes. Pure in-memory logic —
 * callers load state from and persist state to the user's 2FA record; the
 * atomicity of that read-modify-write is the storage layer's job.
 */
export class RecoveryCodeSet {
  private readonly hashes: readonly string[];
  private readonly consumed: boolean[];

  constructor(state: RecoveryCodeSetState) {
    if (state.hashes.length !== state.consumed.length) {
      throw new Error("recovery-code state is corrupt: hashes/consumed length mismatch");
    }
    this.hashes = [...state.hashes];
    this.consumed = [...state.consumed];
  }

  static fromHashes(hashes: readonly string[]): RecoveryCodeSet {
    return new RecoveryCodeSet({ hashes, consumed: hashes.map(() => false) });
  }

  /**
   * Burn the presented code if it matches an unconsumed hash. Every hash is
   * compared in constant time with no early exit, so timing reveals neither
   * a hit nor its position.
   */
  consume(code: string): boolean {
    const presented = hashRecoveryCode(code);
    let matchedIndex: number | null = null;
    for (let i = 0; i < this.hashes.length; i++) {
      const hit = constantTimeEquals(this.hashes[i] ?? "", presented);
      if (hit && !this.consumed[i] && matchedIndex === null) {
        matchedIndex = i;
      }
    }
    if (matchedIndex === null) {
      return false;
    }
    this.consumed[matchedIndex] = true;
    return true;
  }

  get remainingCount(): number {
    return this.consumed.filter((burned) => !burned).length;
  }

  /** Snapshot for persistence (hashes only — never plaintext). */
  get state(): RecoveryCodeSetState {
    return { hashes: [...this.hashes], consumed: [...this.consumed] };
  }
}
