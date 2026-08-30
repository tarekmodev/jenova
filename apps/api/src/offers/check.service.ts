/**
 * Check revalidation (issue #65): the mandatory step between holding an
 * offer and booking it — verify the signed offer, re-ask the SUPPLIER
 * through the adapter registry, and either open the bookable window or
 * surface a price delta for explicit client re-approval.
 *
 * Outcomes:
 * - unchanged  → checked_at stamped; the returned token is bookable inside
 *   the window. (A supplier that rotates its token on check gets a
 *   superseding row transparently — same price, new token.)
 * - changed    → the new supplier state is re-priced through the SAME
 *   pricing context the original offer carried and persisted as a NEW
 *   signed offer; the old offer is invalidated atomically and the caller
 *   gets {oldSell, newSell, newOfferToken} to re-approve. Born checked:
 *   approving client books it without a second supplier round-trip.
 * - failure    → the unified taxonomy (CLAUDE.md rule 4). sold_out and an
 *   adapter-level price_changed rejection (no fresh state to re-price)
 *   invalidate the offer — it can never be booked after the supplier said
 *   no; the client re-searches.
 *
 * Trust boundaries: the price hash signs the MONEY claims (sell, net,
 * supplier token, expiry); breakdown/pricingContext/policy ride as trusted
 * tenant-DB storage, same as every other row the engine acts on.
 */

import type { Locale, Money, SubTenantId, TenantId } from "@jenova/domain";
import { SupplierError, type CancellationPolicy } from "@jenova/domain";
import type {
  AdapterCallContext,
  HotelOffer,
  HotelSupplierAdapter,
} from "@jenova/supplier-sdk";
import { assemblePricedOffer } from "../pricing/offer";
import type { PricingService } from "../pricing/pricing.service";
import type { SettlementSpec } from "../pricing/resolve";
import type { SupplierCredentialsSource, SupplierRegistry } from "@jenova/supplier-registry";
import { OfferError, SupplierUnavailableError } from "./errors";
import type { OffersService, VerifiedOffer } from "./offers.service";

export const OFFER_CHECK_SERVICE = Symbol("jenova.api.offerCheckService");

export interface CheckOfferContext {
  /** Caller's sub-tenant scope (agency realm) — see VerifyOfferOptions. */
  readonly subTenantId?: SubTenantId | null;
  readonly locale?: Locale;
}

export type CheckOfferResult =
  | {
      readonly status: "unchanged";
      readonly offerId: string;
      /** Book with THIS token — it may differ if the supplier rotated its own. */
      readonly offerToken: string;
      readonly sell: Money;
      readonly expiresAt: Date;
      readonly checkedAt: Date;
    }
  | {
      readonly status: "price_changed";
      readonly oldSell: Money;
      readonly newSell: Money;
      /** The successor offer — signed, born checked, awaiting re-approval. */
      readonly newOfferId: string;
      readonly newOfferToken: string;
      readonly newExpiresAt: Date;
      /** True when the cancellation policy moved (with or without the price). */
      readonly policyChanged: boolean;
    };

export interface OfferCheckServiceOptions {
  /** Supplier call time budget in ms (default 15s). */
  readonly checkDeadlineMs?: number;
  /** Clock seam for tests. */
  readonly now?: () => Date;
}

function sameMoney(a: Money, b: Money): boolean {
  return a.amount === b.amount && a.currency === b.currency;
}

/** Order-preserving deep equality — policies are canonical (rules sorted by fromUtc). */
function samePolicy(a: CancellationPolicy | null, b: CancellationPolicy | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    a.refundable === b.refundable &&
    a.rules.length === b.rules.length &&
    a.rules.every(
      (rule, i) =>
        b.rules[i] !== undefined &&
        rule.fromUtc === b.rules[i].fromUtc &&
        sameMoney(rule.penalty, b.rules[i].penalty),
    )
  );
}

export class OfferCheckService {
  private readonly checkDeadlineMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly offers: OffersService,
    private readonly pricing: PricingService,
    private readonly registry: SupplierRegistry,
    private readonly credentials: SupplierCredentialsSource,
    options: OfferCheckServiceOptions = {},
  ) {
    this.checkDeadlineMs = options.checkDeadlineMs ?? 15_000;
    this.now = options.now ?? (() => new Date());
  }

  async checkOffer(
    tenant: TenantId,
    offerToken: string,
    context: CheckOfferContext = {},
  ): Promise<CheckOfferResult> {
    const offer = await this.offers.verifyOfferToken(
      tenant,
      offerToken,
      context.subTenantId === undefined ? {} : { subTenantId: context.subTenantId },
    );
    const adapter = this.hotelAdapterFor(offer);
    const checked = await this.callSupplierCheck(tenant, adapter, offer, context.locale ?? "en");

    // The adapter must echo what was asked; a drifting echo is an adapter
    // bug — an invariant failure, not a client- or supplier-mappable state.
    if (checked.nationalityApplied !== offer.nationality) {
      throw new Error(
        `adapter ${adapter.supplierCode} check() repriced nationality ${checked.nationalityApplied} instead of ${offer.nationality}`,
      );
    }
    if (checked.canonicalPropertyId !== offer.canonicalPropertyId) {
      throw new Error(
        `adapter ${adapter.supplierCode} check() answered for property ${checked.canonicalPropertyId} instead of ${offer.canonicalPropertyId}`,
      );
    }

    const storedSupplierNet = offer.breakdown.fx?.supplierNet ?? offer.net;
    const netUnchanged = sameMoney(checked.net, storedSupplierNet);
    const policyUnchanged = samePolicy(checked.cancellationPolicy, offer.policySnapshot);

    if (netUnchanged && policyUnchanged && checked.supplierOfferToken === offer.supplierOfferToken) {
      const checkedAt = await this.offers.markChecked(tenant, offer.id);
      return {
        status: "unchanged",
        offerId: offer.id,
        offerToken,
        sell: offer.sell,
        expiresAt: offer.expiresAt,
        checkedAt,
      };
    }

    // Something moved — persist the supplier's CURRENT truth as a new
    // signed offer and invalidate the old one atomically.
    const successor = await this.buildSuccessor(tenant, offer, checked);
    const claimed = await this.offers.supersedeOffer(tenant, offer.id, successor.record);
    if (!claimed) {
      // A racing check (or sold_out) claimed this offer first; the winner's
      // response carries the one live successor token. Never mint a second
      // bookable successor (review MEDIUM-1) — refuse retryably instead.
      throw new OfferError(
        "offer_invalidated",
        "this offer was already revalidated or withdrawn concurrently — use the latest check result or search again",
      );
    }

    if (netUnchanged && policyUnchanged) {
      // Only the supplier's own token rotated: same price, same terms —
      // nothing for the client to re-approve, just a fresh token to book.
      return {
        status: "unchanged",
        offerId: successor.record.id,
        offerToken: successor.token,
        sell: successor.record.sell,
        expiresAt: successor.record.expiresAt,
        checkedAt: successor.checkedAt,
      };
    }

    return {
      status: "price_changed",
      oldSell: offer.sell,
      newSell: successor.record.sell,
      newOfferId: successor.record.id,
      newOfferToken: successor.token,
      newExpiresAt: successor.record.expiresAt,
      policyChanged: !policyUnchanged,
    };
  }

  private hotelAdapterFor(offer: VerifiedOffer): HotelSupplierAdapter {
    if (offer.vertical !== "hotel") {
      // Nothing else can mint offers at M1 — invariant, not a client state.
      throw new Error(`offer ${offer.id} is ${offer.vertical}; only hotel offers exist at M1`);
    }
    const adapter = this.registry.hotelAdapter(offer.supplierCode);
    if (adapter === null) {
      throw new SupplierUnavailableError(offer.supplierCode);
    }
    return adapter;
  }

  private async callSupplierCheck(
    tenant: TenantId,
    adapter: HotelSupplierAdapter,
    offer: VerifiedOffer,
    locale: Locale,
  ): Promise<HotelOffer> {
    const ctx: AdapterCallContext = {
      credentials: await this.credentials.credentialsFor(tenant, offer.supplierCode),
      deadline: new Date(this.now().getTime() + this.checkDeadlineMs),
      nationality: offer.nationality,
      // Ask in the currency the supplier originally priced (pre-FX net).
      currency: (offer.breakdown.fx?.supplierNet ?? offer.net).currency,
      locale,
    };
    try {
      return await adapter.check(ctx, offer.supplierOfferToken);
    } catch (error) {
      if (error instanceof SupplierError && (error.kind === "sold_out" || error.kind === "price_changed")) {
        // The supplier said this exact rate no longer exists. Dead offers
        // never come back — invalidate before surfacing. (An adapter-level
        // price_changed rejection carries no fresh state to re-price; the
        // client re-searches. Adapters that return the new rate from check
        // take the supersede path instead.)
        await this.offers.invalidateOffer(tenant, offer.id);
      }
      throw error;
    }
  }

  private async buildSuccessor(tenant: TenantId, offer: VerifiedOffer, checked: HotelOffer) {
    const sellCurrency = offer.sell.currency;
    let settlement: SettlementSpec | undefined;
    if (checked.net.currency !== sellCurrency) {
      const fx = offer.breakdown.fx;
      if (fx === null || fx.rate.from !== checked.net.currency || fx.rate.to !== sellCurrency) {
        // Pricing never looks up rates live (CLAUDE.md rule 6); without a
        // covering stored rate this offer cannot be re-priced.
        throw new SupplierError(
          "price_changed",
          `no stored rate covers ${checked.net.currency}->${sellCurrency} to re-price the checked offer`,
        );
      }
      // Same stored rate + buffer as the original offer: the surfaced delta
      // reflects the SUPPLIER's movement, never FX drift between calls.
      settlement = { currency: sellCurrency, rate: fx.rate, bufferBps: fx.bufferBps };
    }
    const resolution = await this.pricing.price(tenant, checked.net, offer.pricingContext, {
      ...(settlement === undefined ? {} : { settlement }),
      vat: offer.breakdown.vatTreatment,
    });
    const expiresAt = await this.offers.expiryFor(tenant);
    const priced = assemblePricedOffer(
      {
        supplierCode: offer.supplierCode,
        vertical: offer.vertical,
        policySnapshot: checked.cancellationPolicy,
        expiresAt,
      },
      resolution,
    );
    const checkedAt = this.now();
    const record = this.offers.buildRecord(
      tenant,
      {
        offer: priced,
        supplierOfferToken: checked.supplierOfferToken,
        canonicalPropertyId: offer.canonicalPropertyId,
        nationality: offer.nationality,
        occupancy: offer.occupancy,
        pricingContext: offer.pricingContext,
        // The successor carries the CHECKED payload's display facts — the
        // supplier's current truth about what is being sold (0005).
        boardBasis: checked.boardBasis,
        supplierRoomName: checked.supplierRoomName,
      },
      checkedAt,
    );
    return { record, token: this.offers.tokenFor(record), checkedAt };
  }
}
