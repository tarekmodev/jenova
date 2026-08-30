import { describe, expect, it } from "vitest";
import {
  OPAQUE_SECRET_BYTES,
  constantTimeEquals,
  generateOpaqueSecret,
  hashOpaqueSecret,
} from "./tokens";

describe("generateOpaqueSecret", () => {
  it("emits 256-bit base64url secrets with no '.' (safe inside realm.secret)", () => {
    const secret = generateOpaqueSecret();
    // 32 bytes → 43 base64url chars, unpadded.
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secret).not.toContain(".");
    expect(OPAQUE_SECRET_BYTES).toBe(32);
  });

  it("never repeats (CSPRNG, 256-bit space)", () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateOpaqueSecret()));
    expect(seen.size).toBe(1000);
  });
});

describe("hashOpaqueSecret", () => {
  it("is deterministic sha256 hex and never echoes the secret", () => {
    const secret = generateOpaqueSecret();
    const hash = hashOpaqueSecret(secret);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashOpaqueSecret(secret));
    expect(hash).not.toContain(secret);
  });
});

describe("constantTimeEquals", () => {
  it("matches equal strings", () => {
    expect(constantTimeEquals("abc123", "abc123")).toBe(true);
    expect(constantTimeEquals("", "")).toBe(true);
  });

  it("rejects a difference at ANY position", () => {
    expect(constantTimeEquals("abc123", "xbc123")).toBe(false);
    expect(constantTimeEquals("abc123", "abc12x")).toBe(false);
    expect(constantTimeEquals("abc123", "abx123")).toBe(false);
  });

  it("rejects length mismatches WITHOUT throwing (unlike raw timingSafeEqual)", () => {
    expect(constantTimeEquals("short", "much-longer-value")).toBe(false);
    expect(constantTimeEquals("x", "")).toBe(false);
  });

  it("compares multi-byte input by bytes, not code units", () => {
    expect(constantTimeEquals("héllo", "héllo")).toBe(true);
    expect(constantTimeEquals("héllo", "hello")).toBe(false);
  });
});
