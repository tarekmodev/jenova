/**
 * Supplier registry (CLAUDE.md rule 4): THE ONLY place in the engine that
 * may import adapter packages — the ESLint boundary config carves exactly
 * this directory out for that. Everything else speaks the canonical
 * @jenova/supplier-sdk contracts and @jenova/domain types.
 *
 * M1: the TBO hotel adapter binds into REGISTERED_HOTEL_ADAPTERS when its
 * package merges (workstream A); until then the registry is empty and every
 * lookup answers null — callers surface that as supplier unavailability,
 * never as a crash.
 */

import type { SupplierAccountCredentials, HotelSupplierAdapter } from "@jenova/supplier-sdk";
import type { TenantId } from "@jenova/domain";

/** Nest injection token for the process-wide {@link SupplierRegistry}. */
export const SUPPLIER_REGISTRY = Symbol("jenova.api.supplierRegistry");

export interface SupplierRegistry {
  /** null = no adapter for this code is deployed (unknown or not yet merged). */
  hotelAdapter(supplierCode: string): HotelSupplierAdapter | null;
}

export class StaticSupplierRegistry implements SupplierRegistry {
  private readonly hotels: ReadonlyMap<string, HotelSupplierAdapter>;

  constructor(hotelAdapters: readonly HotelSupplierAdapter[]) {
    this.hotels = new Map(hotelAdapters.map((adapter) => [adapter.supplierCode, adapter]));
  }

  hotelAdapter(supplierCode: string): HotelSupplierAdapter | null {
    return this.hotels.get(supplierCode) ?? null;
  }
}

/**
 * Adapter packages register here — e.g. after workstream A merges:
 *   import { createTboHotelAdapter } from "@jenova/adapter-hotel-tbo";
 * and the factory below adds it to the list.
 */
export function createSupplierRegistry(): SupplierRegistry {
  return new StaticSupplierRegistry([]);
}

// ---------------------------------------------------------------------------
// Supplier credentials
// ---------------------------------------------------------------------------

/** Nest injection token for the process-wide {@link SupplierCredentialsSource}. */
export const SUPPLIER_CREDENTIALS_SOURCE = Symbol("jenova.api.supplierCredentialsSource");

/**
 * Resolves a tenant's OWN credentials for one supplier (tenant DB
 * supplier_account row, decrypted at call time — Jenova is a technology
 * partner and never trades on its own accounts). The decrypting
 * implementation lands with the adapter workstream's secret-store wiring;
 * the seam keeps check/book callers unchanged when it does.
 */
export interface SupplierCredentialsSource {
  credentialsFor(tenant: TenantId, supplierCode: string): Promise<SupplierAccountCredentials>;
}

/** M1 default until the secret-store wiring binds: fail loudly, never fake. */
export class UnboundSupplierCredentialsSource implements SupplierCredentialsSource {
  credentialsFor(tenant: TenantId, supplierCode: string): Promise<SupplierAccountCredentials> {
    return Promise.reject(
      new Error(
        `no supplier credentials source is bound (tenant ${tenant}, supplier ${supplierCode}) — ` +
          "the supplier_account decryption wiring has not landed yet",
      ),
    );
  }
}
