/**
 * Offer price-hash signing (issue #64; CLAUDE.md rule 8).
 *
 * A signed, short-lived offer token is the ONLY bookable thing. The price
 * hash is HMAC-SHA256 over ONE canonical serialization of the claims that
 * make an offer an offer — id, sell, net, supplier offer token, expiry —
 * keyed by the server-side OFFER_SIGNING_KEY. Sign and verify both go
 * through {@link canonicalOfferClaims}: there is no second serializer to
 * drift from, so a byte the client (or a compromised row) changes in ANY
 * claim fails verification.
 *
 * KEY ROTATION: one active key. Rotating OFFER_SIGNING_KEY fails
 * verification of every outstanding offer/token — in-flight shoppers get
 * `offer_not_found` and re-search. Offers live for minutes by design, so
 * rotation costs one brief re-search window and never money. (If zero-blip
 * rotation is ever needed, version the token prefix — `of2.` — and verify
 * against a key ring; the serializer below stays unchanged.)
 *
 * NO IO here: pure functions over explicit inputs, fully property-testable.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** The signed claims — exactly what makes a price a bookable price. */
export interface OfferSignatureClaims {
  /** Offer row id (UUID). */
  readonly offerId: string;
  /** Sell amount in minor units (bigint from the row, number from Money). */
  readonly sellAmount: bigint | number;
  /** ISO 4217. */
  readonly sellCurrency: string;
  /** Net amount in minor units — signed so margin can't be tampered either. */
  readonly netAmount: bigint | number;
  /** ISO 4217. */
  readonly netCurrency: string;
  /** Opaque supplier-side token the offer wraps (arbitrary bytes as UTF-8). */
  readonly supplierOfferToken: string;
  /** Expiry as epoch milliseconds UTC — signed, so expiry can't be extended. */
  readonly expiresAtMs: number;
}

export class OfferSigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfferSigningError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_4217_RE = /^[A-Z]{3}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/** Signature bytes: HMAC-SHA256 output length. */
const SIGNATURE_BYTES = 32;

function canonicalAmount(value: bigint | number, field: string): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new OfferSigningError(`${field} must be an integer amount in minor units`);
  }
  if (value < 0) {
    throw new OfferSigningError(`${field} must not be negative`);
  }
  // 123n and 123 serialize identically — the row (bigint) and Money (number)
  // sides of the store produce the same canonical bytes.
  return value.toString();
}

/**
 * THE canonical serialization — the single definition both signing and
 * verification hash. Field order is fixed by this function (never by object
 * key order), every free-form string travels base64url-encoded so no crafted
 * value can collide across field boundaries, and amounts serialize
 * identically from bigint (row) and number (Money) representations.
 */
export function canonicalOfferClaims(claims: OfferSignatureClaims): string {
  const offerId = claims.offerId.toLowerCase();
  if (!UUID_RE.test(offerId)) {
    throw new OfferSigningError("offerId must be a UUID");
  }
  if (!ISO_4217_RE.test(claims.sellCurrency) || !ISO_4217_RE.test(claims.netCurrency)) {
    throw new OfferSigningError("currencies must be 3-letter uppercase ISO 4217 codes");
  }
  if (claims.supplierOfferToken.length === 0) {
    throw new OfferSigningError("supplierOfferToken must be non-empty");
  }
  if (!Number.isSafeInteger(claims.expiresAtMs) || claims.expiresAtMs <= 0) {
    throw new OfferSigningError("expiresAtMs must be a positive epoch-milliseconds integer");
  }
  return [
    "jenova.offer.v1",
    offerId,
    "sell",
    canonicalAmount(claims.sellAmount, "sellAmount"),
    claims.sellCurrency,
    "net",
    canonicalAmount(claims.netAmount, "netAmount"),
    claims.netCurrency,
    "sot",
    Buffer.from(claims.supplierOfferToken, "utf8").toString("base64url"),
    "exp",
    String(claims.expiresAtMs),
  ].join("\n");
}

/** HMAC-SHA256 price hash over the canonical claims, base64url. */
export function signOfferClaims(key: string, claims: OfferSignatureClaims): string {
  return createHmac("sha256", key).update(canonicalOfferClaims(claims)).digest("base64url");
}

/**
 * Constant-time verification: recomputes the HMAC from the claims AS STORED
 * and compares with timingSafeEqual. Never throws — a claim set that cannot
 * even serialize (tampered row) is simply not verified.
 */
export function verifyOfferClaims(
  key: string,
  claims: OfferSignatureClaims,
  signature: string,
): boolean {
  let expected: Buffer;
  try {
    expected = createHmac("sha256", key).update(canonicalOfferClaims(claims)).digest();
  } catch {
    return false;
  }
  if (!BASE64URL_RE.test(signature)) {
    return false;
  }
  const presented = Buffer.from(signature, "base64url");
  if (presented.length !== SIGNATURE_BYTES) {
    // Length is public (all real signatures are 32 bytes) — rejecting early
    // leaks nothing; timingSafeEqual requires equal lengths anyway.
    return false;
  }
  return timingSafeEqual(expected, presented);
}

// ---------------------------------------------------------------------------
// Offer token — what clients hold: offer id + signature, nothing else.
// ---------------------------------------------------------------------------

/** `of1.<offer uuid>.<base64url signature>` */
export function buildOfferToken(offerId: string, signature: string): string {
  const id = offerId.toLowerCase();
  if (!UUID_RE.test(id)) {
    throw new OfferSigningError("offerId must be a UUID");
  }
  if (!BASE64URL_RE.test(signature)) {
    throw new OfferSigningError("signature must be base64url");
  }
  return `of1.${id}.${signature}`;
}

export interface ParsedOfferToken {
  readonly offerId: string;
  readonly signature: string;
}

/** Strict parse; null for anything that is not exactly the token shape. */
export function parseOfferToken(token: string): ParsedOfferToken | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [prefix, offerId, signature] = parts;
  if (prefix !== "of1" || offerId === undefined || signature === undefined) {
    return null;
  }
  if (!UUID_RE.test(offerId) || !BASE64URL_RE.test(signature)) {
    return null;
  }
  return { offerId, signature };
}
