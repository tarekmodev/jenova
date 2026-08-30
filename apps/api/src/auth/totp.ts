/**
 * TOTP primitive — RFC 6238 over RFC 4226 HOTP (issue #33; docs/08:
 * tenant-staff 2FA enforceable by tenant policy).
 *
 * Implemented in-house on node:crypto rather than pulling `otplib`: the
 * whole algorithm is one HMAC + dynamic truncation, `otplib` would be our
 * only runtime dependency wrapping the same createHmac call, and owning
 * the code keeps the drift window and replay-lockout semantics explicit
 * and testable against the RFC's published Appendix B vectors.
 *
 * This module is enrollment + verification only. Login flows (when 2FA is
 * demanded, secret storage — encrypted at rest — and QR RENDERING, which
 * is a frontend concern) land with their apps.
 */

import { createHmac, randomBytes } from "node:crypto";
import { constantTimeEquals } from "./tokens";

export const TOTP_ALGORITHMS = ["sha1", "sha256", "sha512"] as const;
export type TotpAlgorithm = (typeof TOTP_ALGORITHMS)[number];

export interface TotpParams {
  readonly algorithm: TotpAlgorithm;
  readonly digits: 6 | 8;
  readonly stepSeconds: number;
}

/** What Google Authenticator–compatible apps actually implement. */
export const DEFAULT_TOTP_PARAMS: TotpParams = {
  algorithm: "sha1",
  digits: 6,
  stepSeconds: 30,
};

/** Codes from ±1 step are accepted — RFC 6238 §5.2 transmission delay. */
export const DEFAULT_DRIFT_STEPS = 1;

/** RFC 4226 §4 R6: shared secrets of at least 160 bits. */
export const TOTP_SECRET_BYTES = 20;

// ---------------------------------------------------------------------------
// Base32 (RFC 4648) — otpauth secrets are base32 by convention.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET.charAt((value << (5 - bits)) & 31);
  }
  return out;
}

export class InvalidBase32Error extends Error {
  constructor() {
    // Deliberately does not echo the offending input — it may be a secret.
    super("input is not valid unpadded base32");
    this.name = "InvalidBase32Error";
  }
}

export function base32Decode(text: string): Buffer {
  const normalized = text.toUpperCase().replace(/=+$/, "").replace(/[\s-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new InvalidBase32Error();
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---------------------------------------------------------------------------
// HOTP / TOTP

/** RFC 4226 §5.3: HMAC, dynamic truncation, mod 10^digits. */
export function hotp(secret: Buffer, counter: number, params: TotpParams): string {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(params.algorithm, secret).update(counterBytes).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** params.digits).padStart(params.digits, "0");
}

export function totpStep(atMs: number, stepSeconds: number): number {
  return Math.floor(atMs / 1000 / stepSeconds);
}

/** The code a correct authenticator shows at `atMs`. */
export function totpCodeAt(
  secretBase32: string,
  atMs: number,
  params: TotpParams = DEFAULT_TOTP_PARAMS,
): string {
  return hotp(base32Decode(secretBase32), totpStep(atMs, params.stepSeconds), params);
}

/**
 * Match a presented code against the ±driftSteps window around `atMs`.
 * Returns the matched STEP (the replay-lockout key) or null. Every
 * candidate is compared in constant time and the loop never exits early,
 * so timing does not reveal which window position (or whether any) hit.
 */
export function matchTotpCode(
  secretBase32: string,
  code: string,
  atMs: number,
  params: TotpParams = DEFAULT_TOTP_PARAMS,
  driftSteps: number = DEFAULT_DRIFT_STEPS,
): number | null {
  if (!new RegExp(`^\\d{${String(params.digits)}}$`).test(code)) {
    return null;
  }
  const secret = base32Decode(secretBase32);
  const current = totpStep(atMs, params.stepSeconds);
  let matched: number | null = null;
  for (let step = current - driftSteps; step <= current + driftSteps; step++) {
    if (step < 0) {
      continue;
    }
    const hit = constantTimeEquals(hotp(secret, step, params), code);
    if (hit && matched === null) {
      matched = step;
    }
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Enrollment

export interface TotpEnrollment {
  /** Base32 secret — shown to the user ONCE; stored encrypted at rest. */
  readonly secret: string;
  /** `otpauth://` payload for the frontend's QR renderer (no QR here). */
  readonly otpauthUri: string;
  readonly params: TotpParams;
}

export function createTotpEnrollment(input: {
  readonly issuer: string;
  readonly accountName: string;
  readonly params?: TotpParams;
}): TotpEnrollment {
  const params = input.params ?? DEFAULT_TOTP_PARAMS;
  const secret = base32Encode(randomBytes(TOTP_SECRET_BYTES));
  const issuer = encodeURIComponent(input.issuer);
  const account = encodeURIComponent(input.accountName);
  const otpauthUri =
    `otpauth://totp/${issuer}:${account}` +
    `?secret=${secret}&issuer=${issuer}` +
    `&algorithm=${params.algorithm.toUpperCase()}` +
    `&digits=${String(params.digits)}&period=${String(params.stepSeconds)}`;
  return { secret, otpauthUri, params };
}

// ---------------------------------------------------------------------------
// Verification with replay lockout (RFC 6238 §5.2: a code — and with it the
// whole step it belongs to — MUST NOT be accepted twice).

export interface TotpReplayStore {
  getLastAcceptedStep(subjectKey: string): Promise<number | null>;
  setLastAcceptedStep(subjectKey: string, step: number): Promise<void>;
}

/** Nest injection token for the process-wide {@link TotpReplayStore}. */
export const TOTP_REPLAY_STORE = Symbol("jenova.api.totpReplayStore");

/** M0 default: per-process. The redis-backed store binds later. */
export class InMemoryTotpReplayStore implements TotpReplayStore {
  private readonly steps = new Map<string, number>();

  getLastAcceptedStep(subjectKey: string): Promise<number | null> {
    return Promise.resolve(this.steps.get(subjectKey) ?? null);
  }

  setLastAcceptedStep(subjectKey: string, step: number): Promise<void> {
    this.steps.set(subjectKey, step);
    return Promise.resolve();
  }
}

export type TotpVerdict =
  | { readonly accepted: true; readonly step: number }
  | { readonly accepted: false; readonly reason: "invalid_code" | "replayed" };

export interface TotpVerifierOptions {
  readonly clock?: () => number;
  readonly driftSteps?: number;
  readonly params?: TotpParams;
}

export class TotpVerifier {
  private readonly clock: () => number;
  private readonly driftSteps: number;
  private readonly params: TotpParams;

  constructor(
    private readonly replayStore: TotpReplayStore,
    options: TotpVerifierOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.driftSteps = options.driftSteps ?? DEFAULT_DRIFT_STEPS;
    this.params = options.params ?? DEFAULT_TOTP_PARAMS;
  }

  /**
   * @param subjectKey what the lockout is scoped to — one enrolled
   *   credential (e.g. `${tenantId}:${realm}:${userId}`), never global.
   */
  async verify(subjectKey: string, secretBase32: string, code: string): Promise<TotpVerdict> {
    const step = matchTotpCode(secretBase32, code, this.clock(), this.params, this.driftSteps);
    if (step === null) {
      return { accepted: false, reason: "invalid_code" };
    }
    const lastAccepted = await this.replayStore.getLastAcceptedStep(subjectKey);
    // Consuming a step burns it AND everything before it: replaying the
    // same code — or sliding back to an older drift-window code — fails.
    if (lastAccepted !== null && step <= lastAccepted) {
      return { accepted: false, reason: "replayed" };
    }
    await this.replayStore.setLastAcceptedStep(subjectKey, step);
    return { accepted: true, step };
  }
}
