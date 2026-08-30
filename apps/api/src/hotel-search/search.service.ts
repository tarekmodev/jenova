/**
 * Hotel search fan-out orchestrator (issue #59; docs/02-architecture.md
 * "Search fan-out").
 *
 * One search hits every supplier account the tenant has ENABLED whose hotel
 * adapter is registered, in parallel, under one HARD total time budget
 * (~8s, configurable). Partial results are first-class:
 *
 * - every supplier lane runs independently — a slow supplier never delays
 *   another lane's results;
 * - when the budget expires, whatever arrived is what the search returns;
 *   unanswered lanes surface as `supplier.failed` with `supplier_timeout`
 *   and the search completes with status `budget_exhausted`;
 * - a failing lane maps its error through the unified taxonomy (CLAUDE.md
 *   rule 4) and is reported PER SUPPLIER — one supplier's failure never
 *   fails the whole search.
 *
 * Every result is server-priced through the pricing engine and persisted as
 * a SIGNED offer (OffersService) before it leaves this service — the token
 * is the only bookable thing (CLAUDE.md rule 8). Nationality is a
 * first-class parameter (CLAUDE.md rule 9): it rides the AdapterCallContext,
 * adapters must echo it, and it is pinned on every issued offer.
 *
 * Single supplier today (TBO), N-ready by construction: fan-out iterates
 * whatever the registry holds, and the tests drive the N-path through the
 * registry seam.
 */

import { randomUUID } from "node:crypto";
import type { Locale, Money, SalesChannel, SubTenantId, TenantId } from "@jenova/domain";
import { isSupplierError, type SupplierErrorKind } from "@jenova/domain";
import type {
  AdapterCallContext,
  BoardBasis,
  HotelOffer,
  HotelSearchQuery,
  HotelSupplierAdapter,
} from "@jenova/supplier-sdk";
import { assemblePricedOffer } from "../pricing/offer";
import type { PricingService } from "../pricing/pricing.service";
import type { PricingContext } from "../pricing/rules";
import type { OffersService } from "../offers/offers.service";
import type { SupplierCredentialsSource, SupplierRegistry } from "@jenova/supplier-registry";
import type { AvailabilityCache } from "./availability-cache";
import type { SupplierAccountsSource } from "./supplier-accounts";

/** Nest injection token for the process-wide {@link HotelSearchService}. */
export const HOTEL_SEARCH_SERVICE = Symbol("jenova.api.hotelSearchService");

/** Hard total search budget (docs/02: ~8s hotels). Clamped, never unbounded. */
export const DEFAULT_SEARCH_BUDGET_MS = 8_000;
export const MIN_SEARCH_BUDGET_MS = 500;
export const MAX_SEARCH_BUDGET_MS = 30_000;

/** One tenant search, scope resolved by the caller from the verified request context. */
export interface HotelSearchRequest {
  readonly query: HotelSearchQuery;
  /** Guest nationality, ISO 3166-1 alpha-2 — GCC rates vary by it (rule 9). */
  readonly nationality: string;
  /** Requested pricing currency, ISO 4217 (adapters apply it where supported). */
  readonly currency: string;
  readonly locale: Locale;
  /** Buying agency scope from the verified session; null for direct channels. */
  readonly subTenantId: SubTenantId | null;
  readonly channel: SalesChannel;
}

/** What a client may hold per result: the signed token IS the offer (rule 8). */
export interface HotelOfferSummary {
  readonly offerId: string;
  readonly offerToken: string;
  readonly expiresAt: Date;
  readonly supplierCode: string;
  readonly canonicalPropertyId: string;
  readonly supplierRoomName: string;
  readonly boardBasis: BoardBasis;
  /** Server-resolved sell price — never a client-trusted number. */
  readonly sell: Money;
  readonly refundable: boolean;
}

/**
 * Per-lane failure vocabulary: the seven supplier taxonomy kinds, plus
 * `supplier_unavailable` for lanes where no supplier was ever consulted
 * (adapter not deployed, credentials unresolvable, engine-side lane error).
 */
export type SupplierFailureKind = SupplierErrorKind | "supplier_unavailable";

export type SearchCompletionStatus = "complete" | "budget_exhausted";

export type HotelSearchEvent =
  | {
      readonly type: "search.started";
      readonly searchId: string;
      /** Supplier codes actually queried: enabled accounts ∩ registered hotel adapters. */
      readonly supplierCodes: readonly string[];
    }
  | {
      readonly type: "supplier.results";
      readonly searchId: string;
      readonly supplierCode: string;
      /**
       * True when availability came from the short-TTL cache. The offers
       * are STILL freshly priced and freshly signed — only the supplier
       * round-trip was saved (see availability-cache.ts).
       */
      readonly fromCache: boolean;
      readonly offers: readonly HotelOfferSummary[];
    }
  | {
      readonly type: "supplier.failed";
      readonly searchId: string;
      readonly supplierCode: string;
      readonly kind: SupplierFailureKind;
    }
  | {
      readonly type: "search.completed";
      readonly searchId: string;
      /** `budget_exhausted` = partial results: some suppliers never answered. */
      readonly status: SearchCompletionStatus;
      readonly suppliersQueried: number;
      readonly suppliersSucceeded: number;
      readonly suppliersFailed: number;
      readonly offerCount: number;
    };

export interface HotelSearchServiceOptions {
  /** Hard total budget in ms; clamped to [MIN, MAX]. Default 8000. */
  readonly budgetMs?: number;
  /**
   * Short-TTL availability cache (issue #61). A hit saves the supplier
   * round-trip only — cached availability is still re-priced and re-issued
   * as fresh signed offers on every search. Omitted = no caching.
   */
  readonly availabilityCache?: AvailabilityCache;
  /** Clock seam for tests; production uses the real server clock. */
  readonly now?: () => Date;
}

const NATIONALITY_RE = /^[A-Z]{2}$/;
const ISO_4217_RE = /^[A-Z]{3}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const MAX_ROOMS = 9;

function assertValidRequest(request: HotelSearchRequest): void {
  if (!NATIONALITY_RE.test(request.nationality)) {
    throw new Error("search nationality must be an ISO 3166-1 alpha-2 code");
  }
  if (!ISO_4217_RE.test(request.currency)) {
    throw new Error("search currency must be a 3-letter ISO 4217 code");
  }
  const { checkIn, checkOut, rooms } = request.query;
  if (!ISO_DATE_RE.test(checkIn) || !ISO_DATE_RE.test(checkOut)) {
    throw new Error("checkIn/checkOut must be YYYY-MM-DD");
  }
  if (checkOut <= checkIn) {
    throw new Error("checkOut must be after checkIn");
  }
  if (rooms.length === 0 || rooms.length > MAX_ROOMS) {
    throw new Error(`search must cover 1..${MAX_ROOMS} rooms`);
  }
  for (const room of rooms) {
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

function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / DAY_MS);
}

function paxCount(query: HotelSearchQuery): number {
  return query.rooms.reduce((total, room) => total + room.adults + room.childAges.length, 0);
}

type LaneResult = Extract<HotelSearchEvent, { type: "supplier.results" | "supplier.failed" }>;

export class HotelSearchService {
  private readonly budgetMs: number;
  private readonly availability: AvailabilityCache | null;
  private readonly now: () => Date;

  constructor(
    private readonly registry: SupplierRegistry,
    private readonly accounts: SupplierAccountsSource,
    private readonly credentials: SupplierCredentialsSource,
    private readonly pricing: PricingService,
    private readonly offers: OffersService,
    options: HotelSearchServiceOptions = {},
  ) {
    this.budgetMs = Math.min(
      MAX_SEARCH_BUDGET_MS,
      Math.max(MIN_SEARCH_BUDGET_MS, Math.trunc(options.budgetMs ?? DEFAULT_SEARCH_BUDGET_MS)),
    );
    this.availability = options.availabilityCache ?? null;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Runs one tenant search and yields events as suppliers respond. The
   * stream ALWAYS ends with exactly one `search.completed`; every queried
   * supplier is accounted for by exactly one `supplier.results` or
   * `supplier.failed` before it.
   *
   * Lanes abandoned at budget expiry keep running to their transport
   * deadline (which is the same budget boundary, so they abort promptly);
   * anything they issued after abandonment simply expires unused.
   */
  async *search(
    tenant: TenantId,
    request: HotelSearchRequest,
  ): AsyncGenerator<HotelSearchEvent, void, undefined> {
    assertValidRequest(request);
    const searchId = randomUUID();
    const enabled = await this.accounts.enabledSupplierCodes(tenant);
    const queried = enabled.filter((code) => this.registry.hotelAdapter(code) !== null);
    yield { type: "search.started", searchId, supplierCodes: queried };

    let succeeded = 0;
    let failed = 0;
    let offerCount = 0;

    if (queried.length > 0) {
      // Every lane shares the one hard deadline — per-supplier budgets are
      // the remaining window, enforced twice: the AdapterCallContext
      // deadline (the transport aborts at it) and the race below (so even
      // an adapter that ignores its deadline cannot hold the search).
      const deadline = new Date(this.now().getTime() + this.budgetMs);
      const pending = new Map<string, Promise<LaneResult>>(
        queried.map((code) => [code, this.runLane(tenant, searchId, code, request, deadline)]),
      );

      let budgetTimer: ReturnType<typeof setTimeout> | undefined;
      const budgetExpired = new Promise<"budget_expired">((resolve) => {
        budgetTimer = setTimeout(() => resolve("budget_expired"), this.budgetMs);
      });
      try {
        while (pending.size > 0) {
          const next = await Promise.race([budgetExpired, ...pending.values()]);
          if (next === "budget_expired") {
            break;
          }
          pending.delete(next.supplierCode);
          if (next.type === "supplier.results") {
            succeeded += 1;
            offerCount += next.offers.length;
          } else {
            failed += 1;
          }
          yield next;
        }
      } finally {
        clearTimeout(budgetTimer);
      }

      // Budget expiry: what arrived is the result; the rest is reported,
      // never awaited (partial results are first-class).
      for (const supplierCode of pending.keys()) {
        failed += 1;
        yield { type: "supplier.failed", searchId, supplierCode, kind: "supplier_timeout" };
      }
      if (pending.size > 0) {
        yield {
          type: "search.completed",
          searchId,
          status: "budget_exhausted",
          suppliersQueried: queried.length,
          suppliersSucceeded: succeeded,
          suppliersFailed: failed,
          offerCount,
        };
        return;
      }
    }

    yield {
      type: "search.completed",
      searchId,
      status: "complete",
      suppliersQueried: queried.length,
      suppliersSucceeded: succeeded,
      suppliersFailed: failed,
      offerCount,
    };
  }

  /** One supplier lane. NEVER rejects — every failure becomes an event. */
  private async runLane(
    tenant: TenantId,
    searchId: string,
    supplierCode: string,
    request: HotelSearchRequest,
    deadline: Date,
  ): Promise<LaneResult> {
    try {
      const adapter = this.registry.hotelAdapter(supplierCode);
      if (adapter === null) {
        // The registry can change between resolution and the lane running.
        return { type: "supplier.failed", searchId, supplierCode, kind: "supplier_unavailable" };
      }
      const lookup = { supplierCode, query: request.query, nationality: request.nationality };
      // Availability cache (issue #61): a hit saves ONLY the supplier
      // round-trip; pricing + signed-offer issuance below run on every
      // search regardless, so prices and offer TTLs are always current.
      let found = await this.availability?.get(tenant, lookup) ?? null;
      const fromCache = found !== null;
      if (found === null) {
        found = await this.callSupplierSearch(tenant, adapter, request, deadline);
        await this.availability?.put(tenant, lookup, found);
      }
      const offers = await this.priceAndIssue(tenant, supplierCode, request, found);
      return { type: "supplier.results", searchId, supplierCode, fromCache, offers };
    } catch (error) {
      return {
        type: "supplier.failed",
        searchId,
        supplierCode,
        // Supplier failures keep their taxonomy kind; an engine-side lane
        // failure (credentials unresolvable, invariant breach) means no
        // usable supplier answer exists: supplier_unavailable.
        kind: isSupplierError(error) ? error.kind : "supplier_unavailable",
      };
    }
  }

  private async callSupplierSearch(
    tenant: TenantId,
    adapter: HotelSupplierAdapter,
    request: HotelSearchRequest,
    deadline: Date,
  ): Promise<readonly HotelOffer[]> {
    const ctx: AdapterCallContext = {
      credentials: await this.credentials.credentialsFor(tenant, adapter.supplierCode),
      deadline,
      nationality: request.nationality,
      currency: request.currency,
      locale: request.locale,
    };
    const found = await adapter.search(ctx, request.query);
    for (const offer of found) {
      if (offer.nationalityApplied !== request.nationality) {
        // The adapter must echo what was asked — a drifting echo is an
        // adapter bug (rates priced for the wrong nationality must never
        // reach a client), not a supplier-mappable state.
        throw new Error(
          `adapter ${adapter.supplierCode} search() priced nationality ${offer.nationalityApplied} instead of ${request.nationality}`,
        );
      }
    }
    return found;
  }

  /**
   * Server-price each canonical supplier offer and persist it as a signed
   * offer row; only the resulting summaries (token included) leave the
   * service. M1: offers sell in the supplier's net currency — stored-rate
   * settlement plumbs in with the FX-rate source (pricing takes it as a
   * parameter; nothing here changes).
   */
  private async priceAndIssue(
    tenant: TenantId,
    supplierCode: string,
    request: HotelSearchRequest,
    found: readonly HotelOffer[],
  ): Promise<readonly HotelOfferSummary[]> {
    if (found.length === 0) {
      return [];
    }
    const expiresAt = await this.offers.expiryFor(tenant);
    const { query } = request;
    const pricingContext: PricingContext = {
      subTenantId: request.subTenantId,
      channel: request.channel,
      vertical: "hotel",
      supplierCode,
      // Canonical destination codes arrive with the M3 mapping service.
      destination: null,
      travelDate: query.checkIn,
      nights: nightsBetween(query.checkIn, query.checkOut),
      paxCount: paxCount(query),
    };
    const summaries: HotelOfferSummary[] = [];
    for (const offer of found) {
      const resolution = await this.pricing.price(tenant, offer.net, pricingContext);
      const priced = assemblePricedOffer(
        {
          supplierCode,
          vertical: "hotel",
          policySnapshot: offer.cancellationPolicy,
          expiresAt,
        },
        resolution,
      );
      const issued = await this.offers.issueOffer(tenant, {
        offer: priced,
        supplierOfferToken: offer.supplierOfferToken,
        canonicalPropertyId: offer.canonicalPropertyId,
        nationality: request.nationality,
        occupancy: query.rooms,
        pricingContext,
        boardBasis: offer.boardBasis,
        supplierRoomName: offer.supplierRoomName,
      });
      summaries.push({
        offerId: issued.offerId,
        offerToken: issued.offerToken,
        expiresAt: issued.expiresAt,
        supplierCode,
        canonicalPropertyId: offer.canonicalPropertyId,
        supplierRoomName: offer.supplierRoomName,
        boardBasis: offer.boardBasis,
        sell: priced.sell,
        refundable: offer.cancellationPolicy.refundable,
      });
    }
    return summaries;
  }
}
