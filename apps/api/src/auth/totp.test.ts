import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOTP_PARAMS,
  InMemoryTotpReplayStore,
  InvalidBase32Error,
  TotpVerifier,
  base32Decode,
  base32Encode,
  createTotpEnrollment,
  hotp,
  matchTotpCode,
  totpCodeAt,
  totpStep,
  type TotpParams,
} from "./totp";

// ---------------------------------------------------------------------------
// Published IETF test vectors — NOT fabricated data (CLAUDE.md rule 5 allows
// standards vectors; there is no supplier traffic to record for pure crypto).

/** RFC 4226 Appendix D: secret "12345678901234567890", SHA-1, 6 digits. */
const RFC4226_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC4226_HOTP_VECTORS = [
  "755224", "287082", "359152", "969429", "338314",
  "254676", "287922", "162583", "399871", "520489",
] as const;

/**
 * RFC 6238 Appendix B: 8 digits, T0=0, X=30. The seed is the ASCII secret
 * repeated to the HMAC's natural key length per algorithm (errata 2866).
 */
function rfc6238Seed(length: number): Buffer {
  return Buffer.from("1234567890".repeat(7).slice(0, length), "ascii");
}
const RFC6238_PARAMS = (algorithm: TotpParams["algorithm"]): TotpParams => ({
  algorithm,
  digits: 8,
  stepSeconds: 30,
});
const RFC6238_SEED_LENGTH = { sha1: 20, sha256: 32, sha512: 64 } as const;
const RFC6238_VECTORS: ReadonlyArray<{
  timeSeconds: number;
  codes: { sha1: string; sha256: string; sha512: string };
}> = [
  { timeSeconds: 59, codes: { sha1: "94287082", sha256: "46119246", sha512: "90693936" } },
  { timeSeconds: 1111111109, codes: { sha1: "07081804", sha256: "68084774", sha512: "25091201" } },
  { timeSeconds: 1111111111, codes: { sha1: "14050471", sha256: "67062674", sha512: "99943326" } },
  { timeSeconds: 1234567890, codes: { sha1: "89005924", sha256: "91819424", sha512: "93441116" } },
  { timeSeconds: 2000000000, codes: { sha1: "69279037", sha256: "90698825", sha512: "38618901" } },
  { timeSeconds: 20000000000, codes: { sha1: "65353130", sha256: "77737706", sha512: "47863826" } },
];

describe("hotp — RFC 4226 Appendix D vectors", () => {
  it.each(RFC4226_HOTP_VECTORS.map((code, counter) => [counter, code]))(
    "counter %i → %s",
    (counter, code) => {
      expect(hotp(RFC4226_SECRET, counter, DEFAULT_TOTP_PARAMS)).toBe(code);
    },
  );
});

describe("totpCodeAt — RFC 6238 Appendix B vectors", () => {
  for (const algorithm of ["sha1", "sha256", "sha512"] as const) {
    it(`matches all ${algorithm.toUpperCase()} vectors`, () => {
      const secret = base32Encode(rfc6238Seed(RFC6238_SEED_LENGTH[algorithm]));
      for (const vector of RFC6238_VECTORS) {
        expect(totpCodeAt(secret, vector.timeSeconds * 1000, RFC6238_PARAMS(algorithm))).toBe(
          vector.codes[algorithm],
        );
      }
    });
  }
});

describe("base32 codec", () => {
  it("round-trips the RFC 6238 sha1 seed", () => {
    const seed = rfc6238Seed(20);
    expect(base32Decode(base32Encode(seed))).toEqual(seed);
  });

  it("round-trips every length 0..64", () => {
    for (let length = 0; length <= 64; length++) {
      const bytes = rfc6238Seed(64).subarray(0, length);
      expect(base32Decode(base32Encode(bytes))).toEqual(Buffer.from(bytes));
    }
  });

  it("accepts lowercase, separators, and trailing padding", () => {
    const seed = rfc6238Seed(20);
    const encoded = base32Encode(seed);
    expect(base32Decode(encoded.toLowerCase())).toEqual(seed);
    expect(base32Decode(`${encoded.slice(0, 4)}-${encoded.slice(4)}====`)).toEqual(seed);
  });

  it("refuses non-alphabet characters without echoing the input", () => {
    expect(() => base32Decode("ABC!DEF")).toThrowError(InvalidBase32Error);
    try {
      base32Decode("ABC1DEF"); // '1' is not in the RFC 4648 alphabet
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("ABC1DEF");
    }
  });
});

describe("matchTotpCode — drift window", () => {
  const secret = base32Encode(rfc6238Seed(20));
  const nowMs = 1_111_111_111_000;
  const step = totpStep(nowMs, 30);

  it("accepts the current step and ±1 step, reporting which step hit", () => {
    for (const offset of [-1, 0, 1]) {
      const code = totpCodeAt(secret, nowMs + offset * 30_000);
      expect(matchTotpCode(secret, code, nowMs)).toBe(step + offset);
    }
  });

  it("rejects codes from ±2 steps (outside the default window)", () => {
    for (const offset of [-2, 2]) {
      const code = totpCodeAt(secret, nowMs + offset * 30_000);
      expect(matchTotpCode(secret, code, nowMs)).toBeNull();
    }
  });

  it("rejects wrong shapes outright: bad length, non-digits, empty", () => {
    expect(matchTotpCode(secret, "12345", nowMs)).toBeNull();
    expect(matchTotpCode(secret, "1234567", nowMs)).toBeNull();
    expect(matchTotpCode(secret, "12a456", nowMs)).toBeNull();
    expect(matchTotpCode(secret, "", nowMs)).toBeNull();
  });
});

describe("createTotpEnrollment", () => {
  it("emits a 160-bit base32 secret and a well-formed otpauth:// payload", () => {
    const enrollment = createTotpEnrollment({
      issuer: "Jenova",
      accountName: "user@tenant-one.example.test",
    });
    // 20 bytes → 32 base32 chars.
    expect(enrollment.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(enrollment.otpauthUri).toBe(
      `otpauth://totp/Jenova:user%40tenant-one.example.test` +
        `?secret=${enrollment.secret}&issuer=Jenova&algorithm=SHA1&digits=6&period=30`,
    );
    expect(enrollment.params).toEqual(DEFAULT_TOTP_PARAMS);
  });

  it("percent-encodes issuer and account in the label", () => {
    const enrollment = createTotpEnrollment({ issuer: "My Agency", accountName: "a b" });
    expect(enrollment.otpauthUri).toContain("otpauth://totp/My%20Agency:a%20b?");
    expect(enrollment.otpauthUri).toContain("&issuer=My%20Agency&");
  });

  it("generates a fresh secret per enrollment", () => {
    const a = createTotpEnrollment({ issuer: "Jenova", accountName: "u" });
    const b = createTotpEnrollment({ issuer: "Jenova", accountName: "u" });
    expect(a.secret).not.toBe(b.secret);
  });

  it("the enrolled secret verifies end to end", () => {
    const { secret } = createTotpEnrollment({ issuer: "Jenova", accountName: "u" });
    const nowMs = Date.now();
    expect(matchTotpCode(secret, totpCodeAt(secret, nowMs), nowMs)).not.toBeNull();
  });
});

describe("TotpVerifier — replay lockout (RFC 6238 §5.2)", () => {
  const secret = base32Encode(rfc6238Seed(20));

  function verifierAt(startMs: number): { verifier: TotpVerifier; advance: (ms: number) => void } {
    let now = startMs;
    const verifier = new TotpVerifier(new InMemoryTotpReplayStore(), { clock: () => now });
    return {
      verifier,
      advance: (ms) => {
        now += ms;
      },
    };
  }

  it("accepts a correct code once, then refuses the SAME code as replayed", async () => {
    const nowMs = 1_111_111_111_000;
    const { verifier } = verifierAt(nowMs);
    const code = totpCodeAt(secret, nowMs);

    expect(await verifier.verify("subject-1", secret, code)).toEqual({
      accepted: true,
      step: totpStep(nowMs, 30),
    });
    expect(await verifier.verify("subject-1", secret, code)).toEqual({
      accepted: false,
      reason: "replayed",
    });
  });

  it("after consuming the current step, an older drift-window code is also dead", async () => {
    const nowMs = 1_111_111_111_000;
    const { verifier } = verifierAt(nowMs);
    const previousCode = totpCodeAt(secret, nowMs - 30_000);

    expect((await verifier.verify("s", secret, totpCodeAt(secret, nowMs))).accepted).toBe(true);
    expect(await verifier.verify("s", secret, previousCode)).toEqual({
      accepted: false,
      reason: "replayed",
    });
  });

  it("accepts again once time moves to the next step", async () => {
    const nowMs = 1_111_111_111_000;
    const { verifier, advance } = verifierAt(nowMs);

    expect((await verifier.verify("s", secret, totpCodeAt(secret, nowMs))).accepted).toBe(true);
    advance(30_000);
    expect((await verifier.verify("s", secret, totpCodeAt(secret, nowMs + 30_000))).accepted).toBe(
      true,
    );
  });

  it("lockout is scoped per subject — one user's consumption never locks another", async () => {
    const nowMs = 1_111_111_111_000;
    const { verifier } = verifierAt(nowMs);
    const code = totpCodeAt(secret, nowMs);

    expect((await verifier.verify("subject-1", secret, code)).accepted).toBe(true);
    expect((await verifier.verify("subject-2", secret, code)).accepted).toBe(true);
  });

  it("a wrong code is invalid_code and does NOT consume the step", async () => {
    const nowMs = 1_111_111_111_000;
    const { verifier } = verifierAt(nowMs);
    const rightCode = totpCodeAt(secret, nowMs);
    const wrongCode = rightCode === "000000" ? "000001" : "000000";

    expect(await verifier.verify("s", secret, wrongCode)).toEqual({
      accepted: false,
      reason: "invalid_code",
    });
    expect((await verifier.verify("s", secret, rightCode)).accepted).toBe(true);
  });
});
