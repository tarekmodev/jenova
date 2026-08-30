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
import { TENANT_DB_RESOLVER, TenantDbModule } from "../tenancy/tenant-db.module";
import { DrizzleOfferStore, OFFER_STORE, type OfferStore } from "./offer-store";
import {
  FixedOfferTtlSource,
  OFFER_TTL_SOURCE,
  OFFERS_SERVICE,
  OffersService,
  type OfferTtlSource,
} from "./offers.service";

@Module({
  imports: [ConfigModule, TenantDbModule],
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
  ],
  exports: [OFFERS_SERVICE, OFFER_STORE, OFFER_TTL_SOURCE],
})
export class OffersModule {}
