/**
 * Tenancy brands and platform enums (docs/02-architecture.md, docs/03-domain-model.md).
 *
 * TenantId/SubTenantId are branded so a raw string — or the wrong id kind —
 * can never flow into a tenant-scoped call unnoticed. Every service takes
 * explicit tenant/sub-tenant scope arguments of these types.
 */

declare const tenantIdBrand: unique symbol;
declare const subTenantIdBrand: unique symbol;

/** Identifies a tenant (a customer travel company with its own database). */
export type TenantId = string & { readonly [tenantIdBrand]: "TenantId" };

/**
 * Identifies a sub-tenant (Agency or CorporatePartner) INSIDE a tenant's
 * database. Only meaningful alongside a TenantId — never globally unique.
 */
export type SubTenantId = string & { readonly [subTenantIdBrand]: "SubTenantId" };

export class InvalidIdError extends Error {
  constructor(kind: string, value: string) {
    super(`${kind} must be a non-empty string without surrounding whitespace, got ${JSON.stringify(value)}`);
    this.name = "InvalidIdError";
  }
}

function assertIdText(kind: string, value: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new InvalidIdError(kind, value);
  }
}

export function tenantId(value: string): TenantId {
  assertIdText("TenantId", value);
  return value as TenantId;
}

export function subTenantId(value: string): SubTenantId {
  assertIdText("SubTenantId", value);
  return value as SubTenantId;
}

/**
 * The surface a booking is sold through. Channels differ only in parameters
 * (who pays, which markup/policy applies, which gate) — never in code paths:
 * - `b2b` — Agent Portal / B2B app (gate: credit limit)
 * - `corporate` — Corporate Portal (gate: policy + approval)
 * - `b2c` — Storefront website (gate: payment capture)
 * - `api` — Partner API (gate: key + quota)
 * - `internal` — tenant staff booking from the dashboard core workspace
 */
export const SALES_CHANNELS = ["b2b", "corporate", "b2c", "api", "internal"] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

/**
 * Installable apps — entitlement flags checked at the gateway, never
 * codebases (CLAUDE.md rule 3).
 */
export const APP_KEYS = [
  "b2b",
  "corporate",
  "finance",
  "api_access",
  "storefront",
  "crm",
  "desk",
  "contracting",
] as const;
export type AppKey = (typeof APP_KEYS)[number];

/** Product verticals; every vertical books through the same engine services. */
export const VERTICALS = ["hotel", "air", "ground", "package"] as const;
export type Vertical = (typeof VERTICALS)[number];

/** Arabic-first: every surface and document ships both locales (CLAUDE.md rule 9). */
export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export function isSalesChannel(value: string): value is SalesChannel {
  return (SALES_CHANNELS as readonly string[]).includes(value);
}

export function isAppKey(value: string): value is AppKey {
  return (APP_KEYS as readonly string[]).includes(value);
}

export function isVertical(value: string): value is Vertical {
  return (VERTICALS as readonly string[]).includes(value);
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
