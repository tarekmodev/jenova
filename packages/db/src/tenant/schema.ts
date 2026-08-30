/**
 * Tenant schema v1 (docs/03-domain-model.md, tenant table) — every tenant
 * database gets exactly this schema; there are no per-tenant variations
 * (per-deployment code differences are refused, CLAUDE.md rule 3).
 *
 * The SQL in migrations/tenant/ is the source of truth for constraints and
 * triggers (journal balance, append-only enforcement); these Drizzle tables
 * mirror it for typed query building through the tenant resolver.
 *
 * Money is integers: bigint minor units + ISO 4217 code, everywhere
 * (CLAUDE.md rule 6).
 */

import type { BookingItemState, CancellationPolicy, SalesChannel, SubTenantId, Vertical } from "@jenova/domain";
import {
  bigint,
  boolean,
  char,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Encrypted blobs (never plaintext secret columns — CLAUDE.md secrets rule). */
const bytea = customType<{ data: Uint8Array }>({ dataType: () => "bytea" });

export const SUPPLIER_ENVIRONMENTS = ["sandbox", "production"] as const;
export type SupplierEnvironment = (typeof SUPPLIER_ENVIRONMENTS)[number];

export const AGENCY_STATUSES = ["active", "suspended", "closed"] as const;
export type AgencyStatus = (typeof AGENCY_STATUSES)[number];

export const MARKUP_VALUE_TYPES = ["percent", "fixed", "per_night", "per_pax"] as const;
export type MarkupValueType = (typeof MARKUP_VALUE_TYPES)[number];

export const PAYMENT_STATES = ["unpaid", "partially_paid", "paid", "refunded"] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const LEDGER_ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number];

export const AUDIT_ACTOR_TYPES = ["platform_user", "agency_user", "system", "api_client"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/**
 * The tenant's OWN credentials per supplier + environment — Jenova is a
 * technology partner, never a merchant: tenants trade on their own supplier
 * accounts. Secrets are an encrypted blob + the id of the key that encrypted
 * it; plaintext credential columns do not exist.
 */
export const supplierAccounts = pgTable(
  "supplier_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierCode: text("supplier_code").notNull(),
    environment: text("environment").$type<SupplierEnvironment>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    secretsEncrypted: bytea("secrets_encrypted").notNull(),
    secretsKeyId: text("secrets_key_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("supplier_account_code_env_key").on(t.supplierCode, t.environment)],
);

/** B2B trade buyer (a sub-tenant): credit terms in minor units + currency. */
export const agencies = pgTable("agency", {
  id: uuid("id").primaryKey().defaultRandom().$type<SubTenantId>(),
  name: text("name").notNull(),
  status: text("status").$type<AgencyStatus>().notNull().default("active"),
  creditLimitAmount: bigint("credit_limit_amount", { mode: "bigint" }),
  creditCurrency: char("credit_currency", { length: 3 }),
  paymentTermsDays: integer("payment_terms_days"),
  allowedCurrencies: jsonb("allowed_currencies").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** Agents: users with roles within an agency. */
export const agencyUsers = pgTable("agency_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id")
    .notNull()
    .references(() => agencies.id, { onDelete: "cascade" })
    .$type<SubTenantId>(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Ordered, most-specific-wins markup rules. `value` is basis points for
 * percent rules and minor units (with `currency`) for fixed/per-night/per-pax
 * rules — the SQL check ties currency presence to the value type.
 */
export const markupRules = pgTable(
  "markup_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    priority: integer("priority").notNull(),
    agencyId: uuid("agency_id")
      .references(() => agencies.id, { onDelete: "cascade" })
      .$type<SubTenantId>(),
    channel: text("channel").$type<SalesChannel>(),
    vertical: text("vertical").$type<Vertical>(),
    supplierCode: text("supplier_code"),
    destination: text("destination"),
    travelFrom: date("travel_from"),
    travelTo: date("travel_to"),
    valueType: text("value_type").$type<MarkupValueType>().notNull(),
    value: bigint("value", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }),
    commissionSplitBps: integer("commission_split_bps"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("markup_rule_priority_ix").on(t.priority)],
);

/** Occupancy summary one offer was priced for — one entry per room. */
export interface OfferRoomOccupancy {
  readonly adults: number;
  /** One age per child, in years at check-in. Empty when none. */
  readonly childAges: readonly number[];
}

/**
 * Short-lived server-priced result — the ONLY bookable thing (CLAUDE.md
 * rule 8). Carries the signed price hash, TTL expiry, and the id of the
 * markup rule that fired.
 *
 * The 0003 offer-store columns are nullable at the SQL level (expand-only
 * migration); the offers service writes them on every new row and treats a
 * row missing them as unverifiable. `breakdown` / `pricingContext` hold the
 * api pricing engine's PriceBreakdown / PricingContext shapes — typed as
 * loose records here because the db package never imports engine code.
 */
export const offers = pgTable("offer", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierCode: text("supplier_code").notNull(),
  vertical: text("vertical").$type<Vertical>().notNull(),
  netAmount: bigint("net_amount", { mode: "bigint" }).notNull(),
  sellAmount: bigint("sell_amount", { mode: "bigint" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  priceHash: text("price_hash").notNull(),
  markupRuleId: uuid("markup_rule_id").references(() => markupRules.id),
  policySnapshot: jsonb("policy_snapshot").$type<CancellationPolicy>(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  supplierOfferToken: text("supplier_offer_token"),
  canonicalPropertyId: text("canonical_property_id"),
  nationality: char("nationality", { length: 2 }),
  occupancy: jsonb("occupancy").$type<readonly OfferRoomOccupancy[]>(),
  breakdown: jsonb("breakdown").$type<Record<string, unknown>>(),
  pricingContext: jsonb("pricing_context").$type<Record<string, unknown>>(),
  checkedAt: timestamp("checked_at", { withTimezone: true, mode: "date" }),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true, mode: "date" }),
});

/**
 * Commercial container: buyer, channel, totals, payment state.
 * `clientReference` is the caller's idempotency key — unique, so a retried
 * booking call can never create a second booking.
 */
export const bookings = pgTable("booking", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientReference: text("client_reference").notNull().unique(),
  channel: text("channel").$type<SalesChannel>().notNull(),
  agencyId: uuid("agency_id")
    .references(() => agencies.id)
    .$type<SubTenantId>(),
  totalAmount: bigint("total_amount", { mode: "bigint" }).notNull().default(0n),
  currency: char("currency", { length: 3 }).notNull(),
  paymentState: text("payment_state").$type<PaymentState>().notNull().default("unpaid"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * One product unit with its own supplier ref, state machine and policy
 * snapshot. `state` is constrained (SQL check) to BookingItemState values —
 * transition LEGALITY is enforced by the domain state machine in the booking
 * runner, which every surface goes through.
 */
export const bookingItems = pgTable(
  "booking_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    vertical: text("vertical").$type<Vertical>().notNull(),
    state: text("state").$type<BookingItemState>().notNull(),
    supplierCode: text("supplier_code").notNull(),
    supplierAccountId: uuid("supplier_account_id").references(() => supplierAccounts.id),
    supplierReference: text("supplier_reference"),
    offerId: uuid("offer_id").references(() => offers.id),
    netAmount: bigint("net_amount", { mode: "bigint" }).notNull(),
    sellAmount: bigint("sell_amount", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    policySnapshot: jsonb("policy_snapshot").$type<CancellationPolicy>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    // 0004 booking-engine columns (expand-only; see the migration for the
    // full semantics): pending wait start, async-cancel marker, worker poll
    // bookkeeping, and the manual-intervention escalation flag.
    pendingSince: timestamp("pending_since", { withTimezone: true, mode: "date" }),
    cancellationRequestedAt: timestamp("cancellation_requested_at", {
      withTimezone: true,
      mode: "date",
    }),
    pollAttempts: integer("poll_attempts").notNull().default(0),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true, mode: "date" }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true, mode: "date" }),
    escalationReason: text("escalation_reason"),
  },
  (t) => [index("booking_item_booking_ix").on(t.bookingId)],
);

/**
 * Outbox-light domain events (0004): transitions INSERT events in the same
 * transaction that moves state and posts the ledger; the post-commit
 * dispatcher publishes and stamps `publishedAt`. Unpublished rows survive a
 * crash and are re-dispatched by the worker sweep.
 */
export const bookingEvents = pgTable(
  "booking_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    bookingItemId: uuid("booking_item_id").references(() => bookingItems.id, {
      onDelete: "cascade",
    }),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("booking_event_booking_ix").on(t.bookingId)],
);

/** Chart of accounts, per tenant (agency receivables, supplier payables, sales, VAT, ...). */
export const ledgerAccounts = pgTable("ledger_account", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  type: text("type").$type<LedgerAccountType>().notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Double-entry journal. IMMUTABLE: no updated_at, and the database refuses
 * UPDATE/DELETE/TRUNCATE outright. Every entry belongs to a transaction
 * group; a deferred constraint trigger verifies each group sums to zero per
 * currency at COMMIT — an unbalanced posting cannot be committed.
 */
export const journalEntries = pgTable(
  "journal_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionGroupId: uuid("transaction_group_id").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => ledgerAccounts.id),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    bookingId: uuid("booking_id").references(() => bookings.id),
    bookingItemId: uuid("booking_item_id").references(() => bookingItems.id),
    memo: text("memo"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("journal_entry_group_ix").on(t.transactionGroupId),
    index("journal_entry_account_ix").on(t.accountId),
  ],
);

/** Append-only audit trail: insert-only at the database level. */
export const auditEvents = pgTable(
  "audit_event",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    actorType: text("actor_type").$type<AuditActorType>().notNull(),
    actorId: text("actor_id"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("audit_event_entity_ix").on(t.entityType, t.entityId, t.occurredAt)],
);
