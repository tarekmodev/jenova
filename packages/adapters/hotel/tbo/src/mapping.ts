/**
 * TBO → canonical normalization (CLAUDE.md rule 4): Money in integer minor
 * units, UTC cancellation deadlines, canonical board basis, opaque offer
 * tokens. Every rule here is derived from REAL recorded sandbox responses —
 * see README.md for the documented conversions and assumptions.
 */

import {
  money,
  multiplyByScalar,
  SupplierError,
  type CancellationPolicy,
  type CancellationPolicyRule,
  type Money,
} from "@jenova/domain";
import type { BoardBasis } from "@jenova/supplier-sdk";
import type { TboCancelPolicy, TboRoom } from "./schemas";

// ---------------------------------------------------------------------------
// Canonical property ids
// ---------------------------------------------------------------------------

/**
 * Until the licensed mapping service lands (M3 — docs/05-suppliers.md,
 * "Hotel content mapping"), canonical property ids for TBO inventory are the
 * TBO hotel code behind a supplier prefix. The M3 mapping integration
 * replaces the prefix scheme; the adapter contract (canonical ids in,
 * canonical ids out) is already final.
 */
export const TBO_PROPERTY_ID_PREFIX = "tbo:";

export function toCanonicalPropertyId(hotelCode: string): string {
  return `${TBO_PROPERTY_ID_PREFIX}${hotelCode}`;
}

export function toTboHotelCode(canonicalPropertyId: string): string {
  if (!canonicalPropertyId.startsWith(TBO_PROPERTY_ID_PREFIX)) {
    throw new SupplierError(
      "invalid_request",
      `not a TBO canonical property id: ${JSON.stringify(canonicalPropertyId)} (expected "${TBO_PROPERTY_ID_PREFIX}<hotelCode>")`,
    );
  }
  return canonicalPropertyId.slice(TBO_PROPERTY_ID_PREFIX.length);
}

// ---------------------------------------------------------------------------
// Money — exact decimal-to-minor-units conversion at the boundary
// ---------------------------------------------------------------------------

/**
 * ISO 4217 minor-unit exponents. Everything not listed uses 2 (the ISO
 * default, and everything observed from TBO so far: USD, SAR).
 */
const CURRENCY_EXPONENT_EXCEPTIONS: Readonly<Record<string, number>> = {
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
};

export function currencyExponent(currency: string): number {
  return CURRENCY_EXPONENT_EXCEPTIONS[currency] ?? 2;
}

/**
 * TBO returns prices as JSON decimal numbers (e.g. "TotalFare":1057.12),
 * parsed into IEEE doubles. Conversion to minor units is exact for every
 * value TBO can express: a finite double's toString() is its shortest
 * round-tripping decimal — for wire values like 1057.12 that is exactly the
 * wire text — which we decompose into an integer ratio and scale in bigint.
 * Rounding (only if TBO ever sends more decimals than the currency's minor
 * unit) is half-away-from-zero, the same commercial rule as
 * @jenova/domain multiplyByScalar. Documented in README.md.
 */
export function tboAmountToMoney(amount: number, currency: string): Money {
  if (!Number.isFinite(amount)) {
    throw new SupplierError("invalid_request", `TBO amount is not finite: ${String(amount)}`);
  }
  const text = amount.toString();
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(text);
  if (!match) {
    throw new SupplierError("invalid_request", `TBO amount is not a representable decimal: ${text}`);
  }
  const [, sign, intPart, fracPart = "", exp] = match;
  let numerator = BigInt(intPart + fracPart);
  let denominator = 10n ** BigInt(fracPart.length);
  if (exp !== undefined) {
    const e = BigInt(exp);
    if (e > 0n) numerator *= 10n ** e;
    else denominator *= 10n ** -e;
  }
  numerator *= 10n ** BigInt(currencyExponent(currency));
  // Integer division, half away from zero.
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  const minor = sign === "-" ? -rounded : rounded;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new SupplierError("invalid_request", `TBO amount overflows minor units: ${text}`);
  }
  return money(Number(minor), currency);
}

// ---------------------------------------------------------------------------
// Board basis
// ---------------------------------------------------------------------------

/**
 * Meal types observed on real recordings: Room_Only, BreakFast,
 * Breakfast_For_2. TBO spells variants freely (underscores, casing,
 * "_For_N" suffixes), so normalization matches by word, most specific
 * first. Unknown values return undefined and the room is skipped rather
 * than mislabeled — the README documents the policy.
 */
export function normalizeBoardBasis(mealType: string): BoardBasis | undefined {
  const value = mealType.toLowerCase();
  if (/all[\s_-]?inclusive/.test(value)) return "AI";
  if (/full[\s_-]?board/.test(value)) return "FB";
  if (/half[\s_-]?board/.test(value)) return "HB";
  if (/breakfast/.test(value)) return "BB";
  if (/room[\s_-]?only/.test(value)) return "RO";
  return undefined;
}

// ---------------------------------------------------------------------------
// Cancellation policy — supplier-local deadlines → UTC instants
// ---------------------------------------------------------------------------

/**
 * TBO deadline timestamps ("29-08-2026 00:00:00", dd-MM-yyyy HH:mm:ss)
 * carry no timezone marker on any recorded response. We resolve them as
 * IST (UTC+05:30) — TBO's operating timezone. For GCC properties (UTC+3/+4)
 * this reads every deadline ~1.5–2.5h EARLIER than hotel-local midnight
 * would, so Jenova stops treating a rate as freely cancellable before the
 * earliest plausible real deadline — the conservative direction. Assumption
 * documented in README.md; the weekly re-recording drift job re-checks it.
 */
export const TBO_UTC_OFFSET_MINUTES = 330;

const TBO_DATE_TIME = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

export function tboDateTimeToUtcIso(text: string): string {
  const match = TBO_DATE_TIME.exec(text);
  if (!match) {
    throw new SupplierError(
      "invalid_request",
      `TBO deadline is not dd-MM-yyyy HH:mm:ss: ${JSON.stringify(text)}`,
    );
  }
  const [, dd, mm, yyyy, hh, mi, ss] = match as unknown as [
    string, string, string, string, string, string, string,
  ];
  const utcMs =
    Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss)) -
    TBO_UTC_OFFSET_MINUTES * 60_000;
  return new Date(utcMs).toISOString();
}

/**
 * TBO CancelPolicies → normalized CancellationPolicy. ChargeType observed on
 * recordings: "Fixed" (CancellationCharge is an amount in the rate currency)
 * and "Percentage" (percent of TotalFare). Rules are sorted ascending by
 * resolved instant, as the canonical form requires.
 */
export function mapCancellationPolicy(
  policies: readonly TboCancelPolicy[] | undefined,
  net: Money,
  refundable: boolean,
): CancellationPolicy {
  const rules: CancellationPolicyRule[] = (policies ?? []).map((policy) => {
    let penalty: Money;
    if (policy.ChargeType === "Fixed") {
      penalty = tboAmountToMoney(policy.CancellationCharge, net.currency);
    } else if (policy.ChargeType === "Percentage") {
      penalty = multiplyByScalar(net, policy.CancellationCharge / 100);
    } else {
      throw new SupplierError(
        "invalid_request",
        `unknown TBO ChargeType: ${JSON.stringify(policy.ChargeType)}`,
      );
    }
    return { fromUtc: tboDateTimeToUtcIso(policy.FromDate), penalty };
  });
  rules.sort((a, b) => Date.parse(a.fromUtc) - Date.parse(b.fromUtc));
  return { refundable, rules };
}

// ---------------------------------------------------------------------------
// Offer token — the opaque supplier-side token the engine passes back
// ---------------------------------------------------------------------------

/**
 * Everything check/book need to revalidate and consume the rate: TBO's
 * BookingCode plus the priced snapshot (for price_changed detection and
 * Book's TotalFare echo, which TBO requires verbatim). Encoded base64url —
 * opaque to the engine, which wraps it in its own signed Offer (rule 8).
 */
export interface TboOfferTokenV1 {
  readonly v: 1;
  readonly bookingCode: string;
  readonly hotelCode: string;
  readonly currency: string;
  /** TotalFare exactly as on the wire (decimal) — Book must echo it. */
  readonly totalFare: number;
  readonly roomName: string;
  readonly boardBasis: BoardBasis;
  readonly refundable: boolean;
  /** Normalized policy as priced — check() compares it to detect changes. */
  readonly policy: CancellationPolicy;
  readonly nationality: string;
}

export function encodeOfferToken(token: TboOfferTokenV1): string {
  return Buffer.from(JSON.stringify(token), "utf8").toString("base64url");
}

export function decodeOfferToken(supplierOfferToken: string): TboOfferTokenV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(supplierOfferToken, "base64url").toString("utf8"));
  } catch (error) {
    throw new SupplierError("invalid_request", "supplierOfferToken is not a TBO offer token", {
      cause: error,
    });
  }
  const token = parsed as Partial<TboOfferTokenV1>;
  if (token.v !== 1 || typeof token.bookingCode !== "string" || token.bookingCode.length === 0) {
    throw new SupplierError("invalid_request", "supplierOfferToken is not a TBO offer token (v1)");
  }
  return token as TboOfferTokenV1;
}

// ---------------------------------------------------------------------------
// Room → HotelOffer
// ---------------------------------------------------------------------------

export interface MappedOffer {
  readonly supplierOfferToken: string;
  readonly canonicalPropertyId: string;
  readonly supplierRoomName: string;
  readonly boardBasis: BoardBasis;
  readonly net: Money;
  readonly cancellationPolicy: CancellationPolicy;
  readonly nationalityApplied: string;
}

/**
 * Map one TBO room rate to a canonical offer. Returns undefined when the
 * meal type cannot be normalized (the room is skipped, never mislabeled).
 * `nationality` is the GuestNationality the search was priced with — TBO
 * takes it as a first-class request parameter and prices against it.
 */
export function mapRoomToOffer(
  room: TboRoom,
  hotelCode: string,
  currency: string,
  nationality: string,
): MappedOffer | undefined {
  const boardBasis = normalizeBoardBasis(room.MealType);
  if (boardBasis === undefined) {
    return undefined;
  }
  const net = tboAmountToMoney(room.TotalFare, currency);
  const roomName = room.Name[0] ?? "";
  const cancellationPolicy = mapCancellationPolicy(room.CancelPolicies, net, room.IsRefundable);
  return {
    supplierOfferToken: encodeOfferToken({
      v: 1,
      bookingCode: room.BookingCode,
      hotelCode,
      currency,
      totalFare: room.TotalFare,
      roomName,
      boardBasis,
      refundable: room.IsRefundable,
      policy: cancellationPolicy,
      nationality,
    }),
    canonicalPropertyId: toCanonicalPropertyId(hotelCode),
    supplierRoomName: roomName,
    boardBasis,
    net,
    cancellationPolicy,
    nationalityApplied: nationality,
  };
}
