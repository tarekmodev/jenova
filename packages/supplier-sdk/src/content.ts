/**
 * Supplier static-content contracts (M2 issue #96) — the slow-moving
 * destination/property vocabulary the Agent Portal's search form needs
 * (country list → city list → property list). Same normalization law as the
 * lifecycle contracts: canonical shapes only, no supplier payload crosses
 * this boundary (CLAUDE.md rule 4).
 *
 * Ids are supplier-scoped at M2 (`canonicalPropertyId` uses the adapter's
 * prefix scheme, e.g. "tbo:1010062"; `cityId` is the supplier's city code).
 * The M3 licensed mapping service replaces the id scheme; these interfaces
 * do not change.
 */

import type { AdapterCallContext } from "./contracts";

export interface ContentCountry {
  /** ISO 3166-1 alpha-2 where the supplier provides it. */
  readonly code: string;
  readonly name: string;
}

export interface ContentCity {
  /** Supplier-scoped city id, opaque to callers. */
  readonly cityId: string;
  readonly name: string;
  readonly countryCode: string;
}

export interface ContentProperty {
  /** Canonical property id — directly usable as a search target. */
  readonly canonicalPropertyId: string;
  readonly name: string;
  readonly cityId: string;
  readonly countryCode: string;
}

/**
 * Optional per-supplier content capability. Content calls do not price
 * anything: implementations must ignore ctx.nationality/currency (they exist
 * on the shared call context for the transport seam only).
 */
export interface HotelContentAdapter {
  readonly supplierCode: string;
  listCountries(ctx: AdapterCallContext): Promise<readonly ContentCountry[]>;
  listCities(ctx: AdapterCallContext, countryCode: string): Promise<readonly ContentCity[]>;
  listProperties(ctx: AdapterCallContext, cityId: string): Promise<readonly ContentProperty[]>;
}
