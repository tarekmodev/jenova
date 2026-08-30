/**
 * Control-plane schema v1 (docs/03-domain-model.md, control-plane table).
 * Platform-level data ONLY — nothing operational for a tenant lives here;
 * that goes in the tenant schema, one database per tenant.
 *
 * The SQL in migrations/control-plane/ is the source of truth for
 * constraints (checks, triggers); these Drizzle tables mirror it for typed
 * query building.
 */

import type { AppKey, TenantId, Vertical } from "@jenova/domain";
import { char, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const HOSTING_TIERS = ["standard", "dedicated", "private"] as const;
export type HostingTier = (typeof HOSTING_TIERS)[number];

export const CERTIFICATION_STATUSES = ["not_started", "in_progress", "certified", "suspended"] as const;
export type CertificationStatus = (typeof CERTIFICATION_STATUSES)[number];

/** A customer travel company. `dbName` is null until provisioning creates its database. */
export const tenants = pgTable("tenant", {
  id: uuid("id").primaryKey().defaultRandom().$type<TenantId>(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  branding: jsonb("branding").$type<Record<string, unknown>>().notNull().default({}),
  baseCurrency: char("base_currency", { length: 3 }).notNull(),
  vatNumber: text("vat_number"),
  fiscalCountry: char("fiscal_country", { length: 2 }),
  /** Reference into the secret store — never the ZATCA credentials themselves. */
  zatcaCredentialsRef: text("zatca_credentials_ref"),
  hostingTier: text("hosting_tier").$type<HostingTier>().notNull().default("standard"),
  dbName: text("db_name").unique(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** The entitlement record the gateway checks on every request (CLAUDE.md rule 3). */
export const appInstallations = pgTable(
  "app_installation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    appKey: text("app_key").$type<AppKey>().notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    plan: text("plan").notNull().default("standard"),
    installedAt: timestamp("installed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("app_installation_tenant_app_key").on(t.tenantId, t.appKey)],
);

/** Jenova staff (Platform Admin console). Hardware-key 2FA lands with the auth app. */
export const platformUsers = pgTable("platform_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** Platform-level supplier definition + certification status per environment. */
export const supplierCatalogEntries = pgTable("supplier_catalog_entry", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierCode: text("supplier_code").notNull().unique(),
  name: text("name").notNull(),
  vertical: text("vertical").$type<Vertical>().notNull(),
  certificationSandbox: text("certification_sandbox").$type<CertificationStatus>().notNull().default("not_started"),
  certificationProduction: text("certification_production")
    .$type<CertificationStatus>()
    .notNull()
    .default("not_started"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
