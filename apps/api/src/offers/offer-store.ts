/**
 * Offer persistence port + implementations (issue #64).
 *
 * The tenant database `offer` row is the SOURCE OF TRUTH for every offer —
 * deliberately not Redis at M1: an offer is the only bookable thing
 * (CLAUDE.md rule 8) and booking_item.offer_id references it, so it must
 * live where booking transactions live. A Redis read-through cache can bolt
 * onto this port later purely as a latency win; correctness never moves.
 *
 * `DrizzleOfferStore` reaches tenant data ONLY through the @jenova/db
 * resolver (CLAUDE.md rule 1), with the tenant an explicit argument on
 * every method. `InMemoryOfferStore` backs unit tests and carries only the
 * structural values those tests construct.
 */

import { and, eq, isNull } from "drizzle-orm";
import type { CancellationPolicy, Money, TenantId, Vertical } from "@jenova/domain";
import { offers, type OfferRoomOccupancy, type TenantDbResolver } from "@jenova/db";
import type { PriceBreakdown } from "../pricing/resolve";
import type { PricingContext } from "../pricing/rules";

export type { OfferRoomOccupancy };

/** Nest injection token for the process-wide {@link OfferStore}. */
export const OFFER_STORE = Symbol("jenova.api.offerStore");

/**
 * One offer row, domain-typed. The offer-store fields are nullable because
 * the 0003 migration is expand-only — the service refuses to verify a row
 * missing them, so nothing downstream ever meets the nulls.
 */
export interface StoredOffer {
  readonly id: string;
  readonly supplierCode: string;
  readonly vertical: Vertical;
  readonly net: Money;
  readonly sell: Money;
  readonly priceHash: string;
  readonly markupRuleId: string | null;
  readonly policySnapshot: CancellationPolicy | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly supplierOfferToken: string | null;
  readonly canonicalPropertyId: string | null;
  readonly nationality: string | null;
  readonly occupancy: readonly OfferRoomOccupancy[] | null;
  readonly breakdown: PriceBreakdown | null;
  readonly pricingContext: PricingContext | null;
  readonly checkedAt: Date | null;
  readonly invalidatedAt: Date | null;
}

/** A complete new offer — every offer-store field required at write time. */
export interface NewOfferRecord {
  readonly id: string;
  readonly supplierCode: string;
  readonly vertical: Vertical;
  readonly net: Money;
  readonly sell: Money;
  readonly priceHash: string;
  readonly markupRuleId: string | null;
  readonly policySnapshot: CancellationPolicy | null;
  readonly expiresAt: Date;
  readonly supplierOfferToken: string;
  readonly canonicalPropertyId: string;
  readonly nationality: string;
  readonly occupancy: readonly OfferRoomOccupancy[];
  readonly breakdown: PriceBreakdown;
  readonly pricingContext: PricingContext;
  /** Non-null when the offer is born checked (a `check` successor row). */
  readonly checkedAt: Date | null;
}

export interface OfferStore {
  insert(tenant: TenantId, record: NewOfferRecord): Promise<void>;
  findById(tenant: TenantId, offerId: string): Promise<StoredOffer | null>;
  /** Stamps a successful revalidation; no-op on invalidated rows. */
  markChecked(tenant: TenantId, offerId: string, at: Date): Promise<void>;
  /** Withdraws the offer permanently (sold_out / superseded); idempotent. */
  invalidate(tenant: TenantId, offerId: string, at: Date): Promise<void>;
  /**
   * Atomically claims `oldOfferId` (its invalidation must actually flip the
   * row) and inserts its successor in the same transaction. Returns false —
   * inserting NOTHING — when the old offer was already invalidated, e.g. by
   * a concurrently racing check (review MEDIUM-1): for one offer there is
   * never more than one bookable successor.
   */
  supersede(
    tenant: TenantId,
    oldOfferId: string,
    replacement: NewOfferRecord,
    at: Date,
  ): Promise<boolean>;
}

function amountFrom(value: bigint, field: string): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) {
    throw new Error(`offer ${field} exceeds the safe integer range`);
  }
  return amount;
}

type OfferRow = typeof offers.$inferSelect;
type OfferInsert = typeof offers.$inferInsert;

function toStoredOffer(row: OfferRow): StoredOffer {
  return {
    id: row.id,
    supplierCode: row.supplierCode,
    vertical: row.vertical,
    net: { amount: amountFrom(row.netAmount, "net_amount"), currency: row.currency },
    sell: { amount: amountFrom(row.sellAmount, "sell_amount"), currency: row.currency },
    priceHash: row.priceHash,
    markupRuleId: row.markupRuleId,
    policySnapshot: row.policySnapshot,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    supplierOfferToken: row.supplierOfferToken,
    canonicalPropertyId: row.canonicalPropertyId,
    nationality: row.nationality,
    occupancy: row.occupancy,
    // jsonb round-trips of the api's own JSON-safe shapes (no bigints/dates).
    breakdown: row.breakdown as unknown as PriceBreakdown | null,
    pricingContext: row.pricingContext as unknown as PricingContext | null,
    checkedAt: row.checkedAt,
    invalidatedAt: row.invalidatedAt,
  };
}

function toInsertRow(record: NewOfferRecord): OfferInsert {
  return {
    id: record.id,
    supplierCode: record.supplierCode,
    vertical: record.vertical,
    netAmount: BigInt(record.net.amount),
    sellAmount: BigInt(record.sell.amount),
    currency: record.sell.currency,
    priceHash: record.priceHash,
    markupRuleId: record.markupRuleId,
    policySnapshot: record.policySnapshot,
    expiresAt: record.expiresAt,
    supplierOfferToken: record.supplierOfferToken,
    canonicalPropertyId: record.canonicalPropertyId,
    nationality: record.nationality,
    occupancy: record.occupancy,
    breakdown: record.breakdown as unknown as Record<string, unknown>,
    pricingContext: record.pricingContext as unknown as Record<string, unknown>,
    checkedAt: record.checkedAt,
  };
}

export class DrizzleOfferStore implements OfferStore {
  constructor(private readonly resolver: TenantDbResolver) {}

  async insert(tenant: TenantId, record: NewOfferRecord): Promise<void> {
    const db = await this.resolver.getTenantDb(tenant);
    await db.insert(offers).values(toInsertRow(record));
  }

  async findById(tenant: TenantId, offerId: string): Promise<StoredOffer | null> {
    const db = await this.resolver.getTenantDb(tenant);
    const [row] = await db.select().from(offers).where(eq(offers.id, offerId)).limit(1);
    return row === undefined ? null : toStoredOffer(row);
  }

  async markChecked(tenant: TenantId, offerId: string, at: Date): Promise<void> {
    const db = await this.resolver.getTenantDb(tenant);
    await db
      .update(offers)
      .set({ checkedAt: at })
      .where(and(eq(offers.id, offerId), isNull(offers.invalidatedAt)));
  }

  async invalidate(tenant: TenantId, offerId: string, at: Date): Promise<void> {
    const db = await this.resolver.getTenantDb(tenant);
    await db
      .update(offers)
      .set({ invalidatedAt: at })
      .where(and(eq(offers.id, offerId), isNull(offers.invalidatedAt)));
  }

  async supersede(
    tenant: TenantId,
    oldOfferId: string,
    replacement: NewOfferRecord,
    at: Date,
  ): Promise<boolean> {
    const db = await this.resolver.getTenantDb(tenant);
    return db.transaction(async (tx) => {
      // The conditional UPDATE is the claim: under a concurrent supersede,
      // the second transaction blocks on the row lock, re-evaluates the
      // predicate against the winner's committed invalidated_at, matches
      // nothing — and must then insert nothing (review MEDIUM-1).
      const claimed = await tx
        .update(offers)
        .set({ invalidatedAt: at })
        .where(and(eq(offers.id, oldOfferId), isNull(offers.invalidatedAt)))
        .returning({ id: offers.id });
      if (claimed.length !== 1) {
        return false;
      }
      await tx.insert(offers).values(toInsertRow(replacement));
      return true;
    });
  }
}

/**
 * Per-process store for unit tests — holds ONLY the structural values a
 * test constructs (no supplier-shaped data, CLAUDE.md rule 5). Mirrors the
 * Drizzle store's observable behavior, including createdAt stamping and
 * invalidation idempotency.
 */
export class InMemoryOfferStore implements OfferStore {
  private readonly byTenant = new Map<TenantId, Map<string, StoredOffer>>();

  private tenantMap(tenant: TenantId): Map<string, StoredOffer> {
    let map = this.byTenant.get(tenant);
    if (map === undefined) {
      map = new Map();
      this.byTenant.set(tenant, map);
    }
    return map;
  }

  insert(tenant: TenantId, record: NewOfferRecord): Promise<void> {
    const map = this.tenantMap(tenant);
    if (map.has(record.id)) {
      return Promise.reject(new Error(`duplicate offer id ${record.id}`));
    }
    map.set(record.id, {
      ...record,
      createdAt: new Date(),
      invalidatedAt: null,
    });
    return Promise.resolve();
  }

  findById(tenant: TenantId, offerId: string): Promise<StoredOffer | null> {
    return Promise.resolve(this.tenantMap(tenant).get(offerId) ?? null);
  }

  markChecked(tenant: TenantId, offerId: string, at: Date): Promise<void> {
    const map = this.tenantMap(tenant);
    const row = map.get(offerId);
    if (row !== undefined && row.invalidatedAt === null) {
      map.set(offerId, { ...row, checkedAt: at });
    }
    return Promise.resolve();
  }

  invalidate(tenant: TenantId, offerId: string, at: Date): Promise<void> {
    const map = this.tenantMap(tenant);
    const row = map.get(offerId);
    if (row !== undefined && row.invalidatedAt === null) {
      map.set(offerId, { ...row, invalidatedAt: at });
    }
    return Promise.resolve();
  }

  async supersede(
    tenant: TenantId,
    oldOfferId: string,
    replacement: NewOfferRecord,
    at: Date,
  ): Promise<boolean> {
    const row = this.tenantMap(tenant).get(oldOfferId);
    if (row === undefined || row.invalidatedAt !== null) {
      return false; // already claimed elsewhere — insert nothing
    }
    await this.invalidate(tenant, oldOfferId, at);
    await this.insert(tenant, replacement);
    return true;
  }

  /** Test hook: raw row mutation to simulate at-rest tampering. */
  tamper(tenant: TenantId, offerId: string, patch: Partial<StoredOffer>): void {
    const map = this.tenantMap(tenant);
    const row = map.get(offerId);
    if (row === undefined) {
      throw new Error(`no offer ${offerId} to tamper with`);
    }
    map.set(offerId, { ...row, ...patch });
  }
}
