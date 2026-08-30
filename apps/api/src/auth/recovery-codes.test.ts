import { describe, expect, it } from "vitest";
import {
  RECOVERY_CODE_COUNT,
  RecoveryCodeSet,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "./recovery-codes";

describe("generateRecoveryCodes", () => {
  it("emits 10 distinct grouped base32 codes with index-aligned sha256 hashes", () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const [i, code] of codes.entries()) {
      expect(code).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
      expect(hashes[i]).toBe(hashRecoveryCode(code));
      expect(hashes[i]).toMatch(/^[0-9a-f]{64}$/);
      // Hashed at rest: the persisted form never contains the plaintext.
      expect(hashes[i]).not.toContain(normalizeRecoveryCode(code));
    }
  });
});

describe("normalizeRecoveryCode", () => {
  it("strips separators and case so retyped variants hash identically", () => {
    expect(hashRecoveryCode("ab2d-ef3h-ij4l-mn5p")).toBe(hashRecoveryCode("AB2D EF3H IJ4L MN5P"));
    expect(hashRecoveryCode("AB2DEF3HIJ4LMN5P")).toBe(hashRecoveryCode("ab2d-ef3h-ij4l-mn5p"));
  });
});

describe("RecoveryCodeSet", () => {
  it("consumes a valid code exactly ONCE", () => {
    const { codes, hashes } = generateRecoveryCodes();
    const set = RecoveryCodeSet.fromHashes(hashes);
    const code = codes[0]!;

    expect(set.consume(code)).toBe(true);
    expect(set.consume(code)).toBe(false); // one-time: burned
    expect(set.remainingCount).toBe(RECOVERY_CODE_COUNT - 1);
  });

  it("accepts lowercase / separator variants of a stored code, still single-use", () => {
    const { codes, hashes } = generateRecoveryCodes();
    const set = RecoveryCodeSet.fromHashes(hashes);
    const sloppy = codes[1]!.toLowerCase().replaceAll("-", " ");

    expect(set.consume(sloppy)).toBe(true);
    expect(set.consume(codes[1]!)).toBe(false);
  });

  it("rejects codes that were never issued", () => {
    const set = RecoveryCodeSet.fromHashes(generateRecoveryCodes().hashes);
    expect(set.consume("AAAA-AAAA-AAAA-AAAA")).toBe(false);
    expect(set.consume("")).toBe(false);
    expect(set.remainingCount).toBe(RECOVERY_CODE_COUNT);
  });

  it("every code works exactly once until the set is exhausted", () => {
    const { codes, hashes } = generateRecoveryCodes();
    const set = RecoveryCodeSet.fromHashes(hashes);
    for (const code of codes) {
      expect(set.consume(code)).toBe(true);
    }
    expect(set.remainingCount).toBe(0);
    for (const code of codes) {
      expect(set.consume(code)).toBe(false);
    }
  });

  it("round-trips consumption through persisted state (hashes only)", () => {
    const { codes, hashes } = generateRecoveryCodes();
    const first = RecoveryCodeSet.fromHashes(hashes);
    expect(first.consume(codes[2]!)).toBe(true);

    const snapshot = first.state;
    expect(JSON.stringify(snapshot)).not.toContain(normalizeRecoveryCode(codes[2]!));

    const restored = new RecoveryCodeSet(snapshot);
    expect(restored.consume(codes[2]!)).toBe(false); // burn survives persistence
    expect(restored.consume(codes[3]!)).toBe(true);
  });

  it("refuses corrupt state instead of guessing", () => {
    expect(() => new RecoveryCodeSet({ hashes: ["h"], consumed: [] })).toThrowError(/corrupt/);
  });
});
