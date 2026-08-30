/**
 * Supplier registry (CLAUDE.md rule 4): THE ONLY place in the engine that
 * may import adapter packages — the ESLint boundary config carves exactly
 * this directory out for that. Everything else speaks the canonical
 * @jenova/supplier-sdk contracts and @jenova/domain types.
 *
 * M1: the TBO hotel adapter is registered here. Transport wiring follows
 * NODE_ENV (docs/09-testing.md): production=live, development=record
 * (sandbox-replay recorder captures every call), test=replay (recordings
 * only; a miss fails loudly).
 */

import {
  createSkippedRoomRateLog,
  createTboHotelAdapter,
  createTboTransport,
  TBO_SUPPLIER_CODE,
} from "@jenova/adapter-hotel-tbo";
import type { SupplierAccountCredentials, HotelSupplierAdapter } from "@jenova/supplier-sdk";
import type { TenantId } from "@jenova/domain";
import { NODE_ENVS, type NodeEnv } from "../config/config";

/** Nest injection token for the process-wide {@link SupplierRegistry}. */
export const SUPPLIER_REGISTRY = Symbol("jenova.api.supplierRegistry");

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

function nodeEnvFromProcess(): NodeEnv {
  const value = process.env["NODE_ENV"];
  return (NODE_ENVS as readonly string[]).includes(value ?? "")
    ? (value as NodeEnv)
    : "development";
}

export interface SupplierRegistry {
  readonly hotelSupplierCodes: readonly string[];
  /** null = no adapter for this code is deployed — callers surface that as
   * supplier unavailability, never as a crash. */
  hotelAdapter(supplierCode: string): HotelSupplierAdapter | null;
  /**
   * Supplier vocabulary drift: occurrences of unrecognized supplier
   * vocabulary (e.g. a new TBO MealType spelling) keyed `<field>:<rawValue>`
   * (review M1 on #72 — the counter the Platform Admin supplier health
   * board reads; seam only at M1). null = unknown supplier code.
   */
  hotelVocabularyDrift(supplierCode: string): ReadonlyMap<string, number> | null;
}

const NO_DRIFT: ReadonlyMap<string, number> = new Map();

export class StaticSupplierRegistry implements SupplierRegistry {
  private readonly hotels: ReadonlyMap<string, HotelSupplierAdapter>;
  private readonly drift: ReadonlyMap<string, ReadonlyMap<string, number>>;

  constructor(
    hotelAdapters: readonly HotelSupplierAdapter[],
    drift: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map(),
  ) {
    this.hotels = new Map(hotelAdapters.map((adapter) => [adapter.supplierCode, adapter]));
    this.drift = drift;
  }

  get hotelSupplierCodes(): readonly string[] {
    return [...this.hotels.keys()];
  }

  hotelAdapter(supplierCode: string): HotelSupplierAdapter | null {
    return this.hotels.get(supplierCode) ?? null;
  }

  hotelVocabularyDrift(supplierCode: string): ReadonlyMap<string, number> | null {
    if (!this.hotels.has(supplierCode)) {
      return null;
    }
    return this.drift.get(supplierCode) ?? NO_DRIFT;
  }
}

export interface SupplierRegistryOptions {
  /** Defaults from NODE_ENV via {@link transportModeForEnv}. */
  readonly mode?: SupplierTransportMode;
}

/**
 * One entry per certified hotel supplier. Each adapter gets its own
 * transport client (circuit-breaker state per supplier account) and its own
 * vocabulary-drift log so the health board can attribute counts.
 */
export function createSupplierRegistry(options: SupplierRegistryOptions = {}): SupplierRegistry {
  const mode = options.mode ?? transportModeForEnv(nodeEnvFromProcess());
  const tboDrift = createSkippedRoomRateLog();
  return new StaticSupplierRegistry(
    [
      createTboHotelAdapter({
        transport: createTboTransport({ mode }),
        onSkippedRoomRate: tboDrift.observer,
      }),
    ],
    new Map([[TBO_SUPPLIER_CODE, tboDrift.counts()]]),
  );
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
 * implementation lands with the secret-store wiring; the seam keeps
 * check/book callers unchanged when it does.
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
