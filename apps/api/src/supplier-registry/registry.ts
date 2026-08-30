/**
 * Supplier registry — the ONLY place in the codebase that imports adapter
 * packages (CLAUDE.md rule 4; the ESLint boundary rule enforces it). Engine
 * services resolve adapters by platform supplier code and speak
 * @jenova/domain + supplier-sdk canonical types exclusively.
 *
 * Transport wiring per process (docs/09-testing.md):
 *   production  → live      (UndiciTransport under the retry/breaker client)
 *   development → record    (sandbox-replay recorder captures every call)
 *   test        → replay    (recordings only; a miss fails loudly)
 */

import {
  createSkippedRoomRateLog,
  createTboHotelAdapter,
  createTboTransport,
  TBO_SUPPLIER_CODE,
} from "@jenova/adapter-hotel-tbo";
import type { HotelSupplierAdapter } from "@jenova/supplier-sdk";
import type { NodeEnv } from "../config/config";

export type SupplierTransportMode = "live" | "record" | "replay";

export function transportModeForEnv(nodeEnv: NodeEnv): SupplierTransportMode {
  switch (nodeEnv) {
    case "production":
      return "live";
    case "development":
      return "record";
    case "test":
      return "replay";
  }
}

export interface SupplierRegistryOptions {
  readonly mode: SupplierTransportMode;
}

export class UnknownSupplierError extends Error {
  constructor(readonly requestedCode: string) {
    super(`no hotel adapter registered for supplier code ${JSON.stringify(requestedCode)}`);
    this.name = "UnknownSupplierError";
  }
}

export interface SupplierRegistry {
  readonly hotelSupplierCodes: readonly string[];
  hotelAdapter(supplierCode: string): HotelSupplierAdapter;
  /**
   * Supplier vocabulary drift per supplier: occurrences of unrecognized
   * supplier vocabulary (e.g. a new TBO MealType spelling) keyed
   * `<field>:<rawValue>`. The Platform Admin supplier health board reads
   * this counter (review M1 — seam only at M1).
   */
  hotelVocabularyDrift(supplierCode: string): ReadonlyMap<string, number>;
}

export function createSupplierRegistry(options: SupplierRegistryOptions): SupplierRegistry {
  const hotel = new Map<string, HotelSupplierAdapter>();
  const drift = new Map<string, ReadonlyMap<string, number>>();
  // One entry per certified hotel supplier. Each adapter gets its own
  // transport client so circuit-breaker state is per supplier account, and
  // its own drift log so the health board can attribute counts.
  const tboDrift = createSkippedRoomRateLog();
  drift.set(TBO_SUPPLIER_CODE, tboDrift.counts());
  hotel.set(
    TBO_SUPPLIER_CODE,
    createTboHotelAdapter({
      transport: createTboTransport({ mode: options.mode }),
      onSkippedRoomRate: tboDrift.observer,
    }),
  );

  return {
    hotelSupplierCodes: [...hotel.keys()],
    hotelAdapter(supplierCode: string): HotelSupplierAdapter {
      const adapter = hotel.get(supplierCode);
      if (adapter === undefined) {
        throw new UnknownSupplierError(supplierCode);
      }
      return adapter;
    },
    hotelVocabularyDrift(supplierCode: string): ReadonlyMap<string, number> {
      const counts = drift.get(supplierCode);
      if (counts === undefined) {
        throw new UnknownSupplierError(supplierCode);
      }
      return counts;
    },
  };
}
