/**
 * Supplier registry (CLAUDE.md rule 4): THE ONLY place in the engine that
 * may import adapter packages — the ESLint boundary config carves exactly
 * this package out for that, and only the two engine processes (api,
 * worker) may import IT. Everything else speaks the canonical
 * @jenova/supplier-sdk contracts and @jenova/domain types.
 *
 * Moved from apps/api/src/supplier-registry in M1 (issues #67/#68): the
 * worker's pending-confirmation poller retrieves bookings through the same
 * registry, and apps may only import shared packages — never other apps
 * (docs/07-tech-stack.md).
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

/** Nest injection token for the process-wide {@link SupplierRegistry}. */
export const SUPPLIER_REGISTRY = Symbol("jenova.api.supplierRegistry");

/** Mirrors the api/worker config NodeEnv values (docs/09-testing.md). */
const NODE_ENVS = ["development", "test", "production"] as const;
type NodeEnv = (typeof NODE_ENVS)[number];

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

/**
 * DEVELOPMENT-ONLY credentials seam: the repo-root `.env` supplier blocks
 * (Tarek's sandbox test-credentials list) stand in for the tenant's own
 * supplier_account row until the encrypted secret-store wiring lands. The
 * values are REAL sandbox credentials — nothing here fabricates anything —
 * and this source refuses to run outside development. Wired only when
 * NODE_ENV=development; production/test keep Unbound / replay respectively.
 */
export class EnvSupplierCredentialsSource implements SupplierCredentialsSource {
  constructor(private readonly env: Readonly<Record<string, string | undefined>> = process.env) {}

  credentialsFor(tenant: TenantId, supplierCode: string): Promise<SupplierAccountCredentials> {
    if (supplierCode !== TBO_SUPPLIER_CODE) {
      return Promise.reject(
        new Error(`no development credentials mapping for supplier ${supplierCode}`),
      );
    }
    const require = (name: string): string => {
      const value = this.env[name];
      if (value === undefined || value.trim() === "") {
        throw new Error(`${name} is not set — fill the TBO block in the repo-root .env first`);
      }
      return value;
    };
    return Promise.resolve({
      tenantId: tenant,
      supplierCode,
      environment: "sandbox",
      secrets: {
        apiUrl: require("TBO_HOTEL_API_URL"),
        username: require("TBO_HOTEL_USERNAME"),
        password: require("TBO_HOTEL_PASSWORD"),
      },
    });
  }
}
