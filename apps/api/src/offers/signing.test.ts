/**
 * Sign/verify property + unit tests (issue #64).
 *
 * Inputs are ABSTRACT structural values — ids, integer amounts, opaque
 * token strings — nothing imitates a supplier response (CLAUDE.md rule 5).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildOfferToken,
  canonicalOfferClaims,
  OfferSigningError,
  parseOfferToken,
  signOfferClaims,
  verifyOfferClaims,
  type OfferSignatureClaims,
} from "./signing";

const KEY = "unit-test-signing-key-0123456789abcdef";
const OTHER_KEY = "unit-test-signing-key-fedcba9876543210";

const CURRENCIES = ["SAR", "USD", "AED", "KWD", "BHD"] as const;

const amountArb: fc.Arbitrary<bigint | number> = fc.oneof(
  fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  fc.bigInt({ min: 0n, max: 10n ** 15n }),
);

const claimsArb: fc.Arbitrary<OfferSignatureClaims> = fc.record({
  tenantId: fc.string({ minLength: 1, maxLength: 64 }),
  offerId: fc.uuid(),
  sellAmount: amountArb,
  sellCurrency: fc.constantFrom<string>(...CURRENCIES),
  netAmount: amountArb,
  netCurrency: fc.constantFrom<string>(...CURRENCIES),
  supplierOfferToken: fc.string({ minLength: 1, maxLength: 200 }),
  expiresAtMs: fc.integer({ min: 1, max: 2 ** 45 }),
});

/** Same claims, different property insertion order — serialization may not care. */
function reordered(claims: OfferSignatureClaims): OfferSignatureClaims {
  return {
    expiresAtMs: claims.expiresAtMs,
    supplierOfferToken: claims.supplierOfferToken,
    netCurrency: claims.netCurrency,
    netAmount: claims.netAmount,
    sellCurrency: claims.sellCurrency,
    sellAmount: claims.sellAmount,
    offerId: claims.offerId,
    tenantId: claims.tenantId,
  };
}

describe("canonicalOfferClaims", () => {
  it("is canonical under object key reordering", () => {
    fc.assert(
      fc.property(claimsArb, (claims) => {
        expect(canonicalOfferClaims(reordered(claims))).toBe(canonicalOfferClaims(claims));
      }),
    );
  });

  it("serializes bigint and number amounts identically", () => {
    fc.assert(
      fc.property(claimsArb, fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (claims, amount) => {
        const asNumber = { ...claims, sellAmount: amount, netAmount: amount };
        const asBigint = { ...claims, sellAmount: BigInt(amount), netAmount: BigInt(amount) };
        expect(canonicalOfferClaims(asBigint)).toBe(canonicalOfferClaims(asNumber));
      }),
    );
  });

  it("free-form supplier tokens cannot collide across field boundaries", () => {
    // A crafted token embedding the serializer's own delimiter must not
    // produce the serialization of different claims.
    const base: OfferSignatureClaims = {
      tenantId: "tenant-sign",
      offerId: "0b543210-1111-4222-8333-444455556666",
      sellAmount: 5,
      sellCurrency: "SAR",
      netAmount: 4,
      netCurrency: "SAR",
      supplierOfferToken: "t",
      expiresAtMs: 1000,
    };
    const crafted = { ...base, supplierOfferToken: "t\nexp\n2000" };
    expect(canonicalOfferClaims(crafted)).not.toBe(canonicalOfferClaims(base));
    const sneaky = { ...base, supplierOfferToken: "t\nexp" , expiresAtMs: 1000 };
    expect(canonicalOfferClaims(sneaky)).not.toBe(
      canonicalOfferClaims({ ...base, supplierOfferToken: "t", expiresAtMs: 1000 }),
    );
  });

  it("refuses structurally invalid claims", () => {
    const base: OfferSignatureClaims = {
      tenantId: "tenant-sign",
      offerId: "0b543210-1111-4222-8333-444455556666",
      sellAmount: 5,
      sellCurrency: "SAR",
      netAmount: 4,
      netCurrency: "SAR",
      supplierOfferToken: "t",
      expiresAtMs: 1000,
    };
    expect(() => canonicalOfferClaims({ ...base, tenantId: "" })).toThrow(OfferSigningError);
    expect(() => canonicalOfferClaims({ ...base, offerId: "not-a-uuid" })).toThrow(OfferSigningError);
    expect(() => canonicalOfferClaims({ ...base, sellCurrency: "sar" })).toThrow(OfferSigningError);
    expect(() => canonicalOfferClaims({ ...base, sellAmount: 1.5 })).toThrow(OfferSigningError);
    expect(() => canonicalOfferClaims({ ...base, netAmount: -1 })).toThrow(OfferSigningError);
    expect(() => canonicalOfferClaims({ ...base, supplierOfferToken: "" })).toThrow(OfferSigningError);
    expect(() => canonicalOfferClaims({ ...base, expiresAtMs: 0 })).toThrow(OfferSigningError);
    expect(() => canonicalOfferClaims({ ...base, expiresAtMs: 1.5 })).toThrow(OfferSigningError);
  });
});

describe("signOfferClaims / verifyOfferClaims", () => {
  it("round-trips: every well-formed claim set verifies under its own signature", () => {
    fc.assert(
      fc.property(claimsArb, (claims) => {
        const signature = signOfferClaims(KEY, claims);
        expect(verifyOfferClaims(KEY, claims, signature)).toBe(true);
        // ...and under reordered (identical) claims too.
        expect(verifyOfferClaims(KEY, reordered(claims), signature)).toBe(true);
      }),
    );
  });

  it("rejects when ANY signed field is tampered", () => {
    const otherUuid = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    fc.assert(
      fc.property(
        claimsArb,
        fc.constantFrom<(c: OfferSignatureClaims) => OfferSignatureClaims>(
          (c) => ({ ...c, sellAmount: BigInt(c.sellAmount) + 1n }),
          (c) => ({ ...c, netAmount: BigInt(c.netAmount) + 1n }),
          (c) => ({ ...c, sellCurrency: c.sellCurrency === "SAR" ? "USD" : "SAR" }),
          (c) => ({ ...c, netCurrency: c.netCurrency === "SAR" ? "USD" : "SAR" }),
          (c) => ({ ...c, supplierOfferToken: `${c.supplierOfferToken}x` }),
          (c) => ({ ...c, expiresAtMs: c.expiresAtMs + 1 }),
          (c) => ({ ...c, tenantId: `${c.tenantId}x` }),
          (c) => ({ ...c, offerId: c.offerId === otherUuid ? "00000000-0000-4000-8000-000000000000" : otherUuid }),
        ),
        (claims, tamper) => {
          const signature = signOfferClaims(KEY, claims);
          expect(verifyOfferClaims(KEY, tamper(claims), signature)).toBe(false);
        },
      ),
    );
  });

  it("rejects a signature minted under a different key", () => {
    fc.assert(
      fc.property(claimsArb, (claims) => {
        expect(verifyOfferClaims(OTHER_KEY, claims, signOfferClaims(KEY, claims))).toBe(false);
      }),
    );
  });

  it("rejects a malleated signature that decodes to the SAME 32 bytes (non-canonical base64url)", () => {
    // 43 base64url chars carry 258 bits for a 256-bit MAC: the final char's
    // low 2 bits are don't-care, so distinct strings decode identically.
    // The primitive itself must accept only the one canonical encoding —
    // not merely the byte value (review LOW-1).
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    fc.assert(
      fc.property(claimsArb, (claims) => {
        const good = signOfferClaims(KEY, claims);
        const last = good[good.length - 1] as string;
        const idx = alphabet.indexOf(last);
        // Same high 4 bits (the MAC bits), different don't-care low bits.
        const mutated = good.slice(0, -1) + alphabet[(idx & ~0b11) | ((idx + 1) & 0b11)];
        expect(mutated).not.toBe(good);
        expect(Buffer.from(mutated, "base64url").equals(Buffer.from(good, "base64url"))).toBe(true);
        expect(verifyOfferClaims(KEY, claims, good)).toBe(true);
        expect(verifyOfferClaims(KEY, claims, mutated)).toBe(false);
      }),
    );
  });

  it("rejects malformed signatures without throwing", () => {
    const claims: OfferSignatureClaims = {
      tenantId: "tenant-sign",
      offerId: "0b543210-1111-4222-8333-444455556666",
      sellAmount: 5,
      sellCurrency: "SAR",
      netAmount: 4,
      netCurrency: "SAR",
      supplierOfferToken: "t",
      expiresAtMs: 1000,
    };
    const good = signOfferClaims(KEY, claims);
    expect(verifyOfferClaims(KEY, claims, "")).toBe(false);
    expect(verifyOfferClaims(KEY, claims, "!!!not-base64url!!!")).toBe(false);
    expect(verifyOfferClaims(KEY, claims, good.slice(0, -4))).toBe(false); // truncated
    expect(verifyOfferClaims(KEY, claims, `${good}AA`)).toBe(false); // padded
    // Unverifiable claims never throw out of verification.
    expect(verifyOfferClaims(KEY, { ...claims, offerId: "nope" }, good)).toBe(false);
  });
});

describe("offer token", () => {
  it("builds and parses round-trip", () => {
    fc.assert(
      fc.property(fc.uuid(), claimsArb, (offerId, claims) => {
        const signature = signOfferClaims(KEY, claims);
        const token = buildOfferToken(offerId, signature);
        expect(parseOfferToken(token)).toEqual({ offerId: offerId.toLowerCase(), signature });
      }),
    );
  });

  it("rejects malformed tokens", () => {
    expect(parseOfferToken("")).toBeNull();
    expect(parseOfferToken("of1")).toBeNull();
    expect(parseOfferToken("of1.not-a-uuid.c2ln")).toBeNull();
    expect(parseOfferToken("of2.0b543210-1111-4222-8333-444455556666.c2ln")).toBeNull();
    expect(parseOfferToken("of1.0b543210-1111-4222-8333-444455556666.")).toBeNull();
    expect(parseOfferToken("of1.0b543210-1111-4222-8333-444455556666.a.b")).toBeNull();
    expect(parseOfferToken("of1.0b543210-1111-4222-8333-444455556666.sig+/=")).toBeNull();
  });
});
