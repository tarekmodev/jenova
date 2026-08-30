/**
 * Signed offer store (issue #64; CLAUDE.md rule 8).
 *
 * Search results become Offer rows in the TENANT database (the source of
 * truth — Redis may cache reads later, correctness never moves there), each
 * carrying the full PricedOffer breakdown, the opaque supplier offer token,
 * nationality + occupancy the price applies to, a short TTL, and a price
 * hash: HMAC-SHA256 over the canonical claims (offers/signing.ts). Clients
 * hold ONLY `of1.<id>.<signature>` — no price ever rides in a client token,
 * and no client-side price is ever trusted.
 *
 * Verification recomputes the HMAC from the claims AS STORED and compares
 * constant-time, so a tampered amount, expiry, id, or supplier token —
 * whether tampered in flight or at rest — fails as one opaque
 * `offer_not_found`. Expiry is enforced against the SERVER clock and is
 * itself signed, so it cannot be extended.
 *
 * `requireBookableOffer` is the guard the booking engine (workstream E)
 * calls before any supplier book: verified signature + unexpired + not
 * invalidated + a sufficiently recent successful `check`.
 */

import { randomUUID } from "node:crypto";
import type { SubTenantId, TenantId } from "@jenova/domain";
import { assertValidMoney } from "@jenova/domain";
import type { PricedOffer } from "../pricing/offer";
import type { PricingContext } from "../pricing/rules";
import { OfferError } from "./errors";
import {
  buildOfferToken,
  parseOfferToken,
  signOfferClaims,
  verifyOfferClaims,
  type OfferSignatureClaims,
} from "./signing";
import type {
  NewOfferRecord,
  OfferRoomOccupancy,
  OfferStore,
  StoredOffer,
} from "./offer-store";

export const OFFERS_SERVICE = Symbol("jenova.api.offersService");
export const OFFER_TTL_SOURCE = Symbol("jenova.api.offerTtlSource");

/** Offers are short-lived BY DESIGN: minutes, hard-capped at 30. */
export const DEFAULT_OFFER_TTL_SECONDS = 900;
export const MIN_OFFER_TTL_SECONDS = 60;
export const MAX_OFFER_TTL_SECONDS = 1_800;

/** After a successful `check`, how long the offer stays bookable. */
export const DEFAULT_BOOKABLE_WINDOW_SECONDS = 600;

/**
 * Where a tenant's offer TTL comes from. Per-tenant commercial settings
 * bind here when the tenant-settings surface lands; the fixed default keeps
 * every tenant on the platform-safe value until then. Values are clamped to
 * [MIN, MAX] regardless of source — no configuration can mint long-lived
 * prices.
 */
export interface OfferTtlSource {
  offerTtlSeconds(tenant: TenantId): Promise<number>;
}

export class FixedOfferTtlSource implements OfferTtlSource {
  constructor(private readonly seconds: number = DEFAULT_OFFER_TTL_SECONDS) {}

  offerTtlSeconds(): Promise<number> {
    return Promise.resolve(this.seconds);
  }
}

/** What the search layer hands over per result, alongside the PricedOffer. */
export interface IssueOfferInput {
  /** Server-priced payload from the pricing engine (issue #63). */
  readonly offer: PricedOffer;
  /** Opaque supplier-side token `check` revalidates and `book` consumes. */
  readonly supplierOfferToken: string;
  /** Canonical property id (mapping service). */
  readonly canonicalPropertyId: string;
  /** ISO 3166-1 alpha-2 the supplier actually priced for. */
  readonly nationality: string;
  readonly occupancy: readonly OfferRoomOccupancy[];
  /** Context the markup resolution ran with — replayed on `check` re-price. */
  readonly pricingContext: PricingContext;
}

/** What clients get back: the token IS the offer. */
export interface IssuedOffer {
  readonly offerId: string;
  readonly offerToken: string;
  readonly expiresAt: Date;
}

/** A StoredOffer whose offer-store fields are proven present. */
export interface VerifiedOffer extends StoredOffer {
  readonly supplierOfferToken: string;
  readonly canonicalPropertyId: string;
  readonly nationality: string;
  readonly occupancy: readonly OfferRoomOccupancy[];
  readonly breakdown: NonNullable<StoredOffer["breakdown"]>;
  readonly pricingContext: PricingContext;
}

export interface VerifyOfferOptions {
  /**
   * Sub-tenant scope of the caller (agency realm). When provided, the offer
   * must have been priced FOR that scope — another agency's offer (another
   * markup) is an opaque `offer_not_found`. `null` means the caller is
   * un-scoped (direct channels).
   */
  readonly subTenantId?: SubTenantId | null;
}

export interface OffersServiceOptions {
  /** Bookable window after a successful check, seconds (default 600). */
  readonly bookableWindowSeconds?: number;
  /** Clock seam for tests; production uses the real server clock. */
  readonly now?: () => Date;
}

const NATIONALITY_RE = /^[A-Z]{2}$/;
const MAX_ROOMS = 9;

function assertValidOccupancy(occupancy: readonly OfferRoomOccupancy[]): void {
  if (occupancy.length === 0 || occupancy.length > MAX_ROOMS) {
    throw new Error(`offer occupancy must cover 1..${MAX_ROOMS} rooms`);
  }
  for (const room of occupancy) {
    if (!Number.isSafeInteger(room.adults) || room.adults < 1) {
      throw new Error("each room needs at least one adult");
    }
    for (const age of room.childAges) {
      if (!Number.isSafeInteger(age) || age < 0 || age > 17) {
        throw new Error("child ages must be integers in 0..17");
      }
    }
  }
}

export class OffersService {
  private readonly bookableWindowMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly store: OfferStore,
    private readonly ttlSource: OfferTtlSource,
    private readonly signingKey: string,
    options: OffersServiceOptions = {},
  ) {
    if (signingKey.length < 32) {
      // Config enforces this too — refuse a weak key even when constructed directly.
      throw new Error("offer signing key must be at least 32 characters");
    }
    this.bookableWindowMs = (options.bookableWindowSeconds ?? DEFAULT_BOOKABLE_WINDOW_SECONDS) * 1_000;
    this.now = options.now ?? (() => new Date());
  }

  /** TTL boundary for a new offer — what search feeds assemblePricedOffer. */
  async expiryFor(tenant: TenantId, from?: Date): Promise<Date> {
    const configured = await this.ttlSource.offerTtlSeconds(tenant);
    const seconds = Math.min(
      MAX_OFFER_TTL_SECONDS,
      Math.max(MIN_OFFER_TTL_SECONDS, Math.trunc(configured)),
    );
    return new Date((from ?? this.now()).getTime() + seconds * 1_000);
  }

  /**
   * Persists one priced search result as an Offer row and returns the
   * signed token — called by the search service per result the client may
   * book. `checkedAt: null`: a fresh offer must pass `check` before booking.
   */
  async issueOffer(tenant: TenantId, input: IssueOfferInput): Promise<IssuedOffer> {
    const record = this.buildRecord(tenant, input, null);
    await this.store.insert(tenant, record);
    return {
      offerId: record.id,
      offerToken: this.tokenFor(record),
      expiresAt: record.expiresAt,
    };
  }

  /**
   * Builds a fully validated, signed offer record WITHOUT persisting it —
   * the check flow uses this to supersede an offer atomically. The tenant
   * participates in the signature (a cross-tenant token fails at the HMAC,
   * not merely at the per-tenant row lookup).
   */
  buildRecord(tenant: TenantId, input: IssueOfferInput, checkedAt: Date | null): NewOfferRecord {
    const { offer } = input;
    assertValidMoney(offer.net);
    assertValidMoney(offer.sell);
    if (offer.net.currency !== offer.currency || offer.sell.currency !== offer.currency) {
      throw new Error("offer is single-currency: net, sell and currency must agree");
    }
    if (input.supplierOfferToken.length === 0) {
      throw new Error("supplierOfferToken must be non-empty");
    }
    if (input.canonicalPropertyId.length === 0) {
      throw new Error("canonicalPropertyId must be non-empty");
    }
    if (!NATIONALITY_RE.test(input.nationality)) {
      throw new Error("nationality must be an ISO 3166-1 alpha-2 code");
    }
    assertValidOccupancy(input.occupancy);
    const now = this.now();
    const remainingMs = offer.expiresAt.getTime() - now.getTime();
    if (Number.isNaN(remainingMs) || remainingMs <= 0) {
      throw new Error("offer expiresAt must be in the future");
    }
    if (remainingMs > MAX_OFFER_TTL_SECONDS * 1_000) {
      throw new Error(`offer TTL exceeds the ${MAX_OFFER_TTL_SECONDS}s cap — offers are short-lived by design`);
    }
    // The fresh id participates in the hash, so mint it first and sign after.
    return this.withPriceHash(tenant, {
      id: randomUUID(),
      supplierCode: offer.supplierCode,
      vertical: offer.vertical,
      net: offer.net,
      sell: offer.sell,
      priceHash: "", // replaced by withPriceHash
      markupRuleId: offer.markupRuleId,
      policySnapshot: offer.policySnapshot,
      expiresAt: offer.expiresAt,
      supplierOfferToken: input.supplierOfferToken,
      canonicalPropertyId: input.canonicalPropertyId,
      nationality: input.nationality,
      occupancy: input.occupancy,
      breakdown: offer.breakdown,
      pricingContext: input.pricingContext,
      checkedAt,
    });
  }

  /**
   * Signed token for a built record. `priceHash` IS the signature — the
   * stored column and the client-held token half are the same HMAC, minted
   * once in {@link buildRecord}.
   */
  tokenFor(record: NewOfferRecord): string {
    return buildOfferToken(record.id, record.priceHash);
  }

  /**
   * Verifies an offer token end to end: parse → load → constant-time
   * signature check over the STORED claims → scope → invalidation → server
   * clock vs signed expiry. Everything except expiry/invalidated is one
   * opaque `offer_not_found` (see offers/errors.ts).
   */
  async verifyOfferToken(
    tenant: TenantId,
    offerToken: string,
    options: VerifyOfferOptions = {},
  ): Promise<VerifiedOffer> {
    const parsed = parseOfferToken(offerToken);
    if (parsed === null) {
      throw new OfferError("offer_not_found", "unknown offer");
    }
    const row = await this.store.findById(tenant, parsed.offerId);
    if (row === null) {
      throw new OfferError("offer_not_found", "unknown offer");
    }
    const verified = this.verifyRow(tenant, row, parsed.signature);
    if (verified === null) {
      throw new OfferError("offer_not_found", "unknown offer");
    }
    if (options.subTenantId !== undefined) {
      if (verified.pricingContext.subTenantId !== options.subTenantId) {
        throw new OfferError("offer_not_found", "unknown offer");
      }
    }
    if (verified.invalidatedAt !== null) {
      throw new OfferError("offer_invalidated", "this offer has been withdrawn — search again");
    }
    if (this.now().getTime() >= verified.expiresAt.getTime()) {
      throw new OfferError("offer_expired", "this offer has expired — search again");
    }
    return verified;
  }

  /**
   * THE booking gate (workstream E calls this before any supplier book):
   * a booking requires a verified, unexpired, uninvalidated offer with a
   * successful `check` inside the bookable window.
   */
  async requireBookableOffer(
    tenant: TenantId,
    offerToken: string,
    options: VerifyOfferOptions = {},
  ): Promise<VerifiedOffer> {
    const offer = await this.verifyOfferToken(tenant, offerToken, options);
    if (offer.checkedAt === null) {
      throw new OfferError("offer_not_checked", "offer must pass check before booking");
    }
    const age = this.now().getTime() - offer.checkedAt.getTime();
    if (age > this.bookableWindowMs) {
      throw new OfferError("offer_not_checked", "the check has gone stale — check again before booking");
    }
    return offer;
  }

  /** Marks a successful revalidation on an existing (verified) offer. */
  async markChecked(tenant: TenantId, offerId: string): Promise<Date> {
    const at = this.now();
    await this.store.markChecked(tenant, offerId, at);
    return at;
  }

  /** Withdraws an offer permanently (sold_out, superseded, policy kill). */
  async invalidateOffer(tenant: TenantId, offerId: string): Promise<void> {
    await this.store.invalidate(tenant, offerId, this.now());
  }

  /**
   * Atomically claims an offer for booking — ONE book attempt per offer,
   * enforced at the row (conditional invalidation, rowcount-gated): under
   * two racing book calls exactly one claim wins, so only one supplier
   * book() can ever be sent for one offer. False = already consumed,
   * superseded or withdrawn.
   */
  async claimOfferForBooking(tenant: TenantId, offerId: string): Promise<boolean> {
    return this.store.claim(tenant, offerId, this.now());
  }

  /**
   * Atomically replaces `oldOfferId` with a re-priced successor. False when
   * a concurrently racing check claimed the old offer first — the successor
   * is then NOT persisted (one offer, at most one bookable successor).
   */
  async supersedeOffer(
    tenant: TenantId,
    oldOfferId: string,
    replacement: NewOfferRecord,
  ): Promise<boolean> {
    return this.store.supersede(tenant, oldOfferId, replacement, this.now());
  }

  private claimsOf(
    tenant: TenantId,
    record: {
      id: string;
      net: NewOfferRecord["net"];
      sell: NewOfferRecord["sell"];
      supplierOfferToken: string;
      expiresAt: Date;
    },
  ): OfferSignatureClaims {
    return {
      tenantId: tenant,
      offerId: record.id,
      sellAmount: record.sell.amount,
      sellCurrency: record.sell.currency,
      netAmount: record.net.amount,
      netCurrency: record.net.currency,
      supplierOfferToken: record.supplierOfferToken,
      expiresAtMs: record.expiresAt.getTime(),
    };
  }

  private withPriceHash(tenant: TenantId, record: NewOfferRecord): NewOfferRecord {
    return { ...record, priceHash: signOfferClaims(this.signingKey, this.claimsOf(tenant, record)) };
  }

  /** Null when the row is unverifiable — missing fields or bad signature. */
  private verifyRow(tenant: TenantId, row: StoredOffer, signature: string): VerifiedOffer | null {
    if (
      row.supplierOfferToken === null ||
      row.canonicalPropertyId === null ||
      row.nationality === null ||
      row.occupancy === null ||
      row.breakdown === null ||
      row.pricingContext === null
    ) {
      return null;
    }
    const claims = this.claimsOf(tenant, {
      id: row.id,
      net: row.net,
      sell: row.sell,
      supplierOfferToken: row.supplierOfferToken,
      expiresAt: row.expiresAt,
    });
    if (!verifyOfferClaims(this.signingKey, claims, signature)) {
      return null;
    }
    // LOAD-BEARING (not removable hardening): the presented signature must
    // be the exact string minted at issue time. This independently pins
    // signature-string uniqueness (verifyOfferClaims also rejects
    // non-canonical base64url, but this check must not rely on that) and
    // fails a row whose hash column was rewritten alongside its amounts —
    // the client's signature was minted over the original amounts.
    if (row.priceHash !== signature) {
      return null;
    }
    return {
      ...row,
      supplierOfferToken: row.supplierOfferToken,
      canonicalPropertyId: row.canonicalPropertyId,
      nationality: row.nationality,
      occupancy: row.occupancy,
      breakdown: row.breakdown,
      pricingContext: row.pricingContext,
    };
  }
}
