/**
 * Offer store module (issues #64/#65): signed server-priced offers — the
 * ONLY bookable thing (CLAUDE.md rule 8).
 *
 * Every surface's search persists offers through OFFERS_SERVICE and every
 * booking passes its guard; per-surface differences are parameters, never
 * forks (CLAUDE.md rule 2).
 */

import { Module } from "@nestjs/common";
import type { TenantDbResolver } from "@jenova/db";
import { API_CONFIG, type ApiConfig } from "../config/config";
import { ConfigModule } from "../config/config.module";
import { PRICING_SERVICE, type PricingService } from "../pricing/pricing.service";
import { PricingModule } from "../pricing/pricing.module";
import {
  createSupplierRegistry,
  EnvSupplierCredentialsSource,
  SUPPLIER_CREDENTIALS_SOURCE,
  SUPPLIER_REGISTRY,
  type SupplierCredentialsSource,
  type SupplierRegistry,
} from "@jenova/supplier-registry";
import type { SecretBox } from "../tenancy/secret-box";
import { SECRET_BOX } from "../tenancy/secret-box";
import {
  DrizzleSupplierCredentialsSource,
  FallbackSupplierCredentialsSource,
} from "../tenancy/supplier-credentials";
import { TENANT_DB_RESOLVER, TenantDbModule } from "../tenancy/tenant-db.module";
import { OFFER_CHECK_SERVICE, OfferCheckService } from "./check.service";
import { DrizzleOfferStore, OFFER_STORE, type OfferStore } from "./offer-store";
import { OffersController } from "./offers.controller";
import {
  FixedOfferTtlSource,
  OFFER_TTL_SOURCE,
  OFFERS_SERVICE,
  OffersService,
  type OfferTtlSource,
} from "./offers.service";

@Module({
  imports: [ConfigModule, PricingModule, TenantDbModule],
  controllers: [OffersController],
  providers: [
    {
      provide: OFFER_STORE,
      inject: [TENANT_DB_RESOLVER],
      useFactory: (resolver: TenantDbResolver) => new DrizzleOfferStore(resolver),
    },
    {
      // Per-tenant TTL settings bind here when the tenant-settings surface
      // lands; until then every tenant gets the platform-safe default, and
      // the service clamps ANY source to the short-lived bounds.
      provide: OFFER_TTL_SOURCE,
      useFactory: () => new FixedOfferTtlSource(),
    },
    {
      provide: OFFERS_SERVICE,
      inject: [OFFER_STORE, OFFER_TTL_SOURCE, API_CONFIG],
      useFactory: (store: OfferStore, ttl: OfferTtlSource, config: ApiConfig) =>
        new OffersService(store, ttl, config.offerSigningKey),
    },
    {
      // The ONLY place adapter packages bind (CLAUDE.md rule 4) — empty
      // until the first hotel adapter (workstream A) merges and registers.
      provide: SUPPLIER_REGISTRY,
      useFactory: () => createSupplierRegistry(),
    },
    {
      // Tenant supplier_account rows, sealed at rest, decrypted at call
      // time (M2 #91 — the promised secret-store wiring). Production trades
      // on production accounts; everything else on sandbox. Development
      // additionally falls back to the repo .env sandbox credentials for
      // tenants that have not saved an account yet (real credentials, the
      // tenant's own sandbox — never fakes).
      provide: SUPPLIER_CREDENTIALS_SOURCE,
      inject: [API_CONFIG, TENANT_DB_RESOLVER, SECRET_BOX],
      useFactory: (
        config: ApiConfig,
        resolver: TenantDbResolver,
        secrets: SecretBox,
      ): SupplierCredentialsSource => {
        const stored = new DrizzleSupplierCredentialsSource(
          resolver,
          secrets,
          config.nodeEnv === "production" ? "production" : "sandbox",
        );
        return config.nodeEnv === "development"
          ? new FallbackSupplierCredentialsSource(stored, new EnvSupplierCredentialsSource())
          : stored;
      },
    },
    {
      provide: OFFER_CHECK_SERVICE,
      inject: [OFFERS_SERVICE, PRICING_SERVICE, SUPPLIER_REGISTRY, SUPPLIER_CREDENTIALS_SOURCE],
      useFactory: (
        offersService: OffersService,
        pricing: PricingService,
        registry: SupplierRegistry,
        credentials: SupplierCredentialsSource,
      ) => new OfferCheckService(offersService, pricing, registry, credentials),
    },
  ],
  // SUPPLIER_REGISTRY / SUPPLIER_CREDENTIALS_SOURCE are exported so every
  // engine module shares the ONE process-wide instance (per-account circuit
  // breakers, vocabulary-drift counters) — the binding itself stays here.
  exports: [
    OFFERS_SERVICE,
    OFFER_CHECK_SERVICE,
    OFFER_STORE,
    OFFER_TTL_SOURCE,
    SUPPLIER_REGISTRY,
    SUPPLIER_CREDENTIALS_SOURCE,
  ],
})
export class OffersModule {}
