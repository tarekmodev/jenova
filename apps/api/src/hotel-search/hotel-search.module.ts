/**
 * Hotel search & availability module (M1, issues #59/#60/#61;
 * docs/milestones/M01-engine-spine.md "Search & availability service").
 *
 * Every surface searches through HOTEL_SEARCH_SERVICE — per-surface
 * differences (who is buying, which markup applies) are request parameters,
 * never forks (CLAUDE.md rule 2).
 */

import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { TenantDbResolver } from "@jenova/db";
import { API_CONFIG, type ApiConfig } from "../config/config";
import { ConfigModule } from "../config/config.module";
import { OffersModule } from "../offers/offers.module";
import { OFFERS_SERVICE, type OffersService } from "../offers/offers.service";
import { PricingModule } from "../pricing/pricing.module";
import { PRICING_SERVICE, type PricingService } from "../pricing/pricing.service";
import {
  SUPPLIER_CREDENTIALS_SOURCE,
  SUPPLIER_REGISTRY,
  type SupplierCredentialsSource,
  type SupplierRegistry,
} from "../supplier-registry";
import { TENANT_DB_RESOLVER, TenantDbModule } from "../tenancy/tenant-db.module";
import {
  AVAILABILITY_CACHE,
  AvailabilityCache,
  FixedSearchCacheTtlSource,
  SEARCH_CACHE_TTL_SOURCE,
  type SearchCacheTtlSource,
} from "./availability-cache";
import { RedisSearchCache, SEARCH_CACHE, type SearchCache } from "./cache";
import { HotelSearchController } from "./search.controller";
import { HOTEL_SEARCH_SERVICE, HotelSearchService } from "./search.service";
import { STATIC_CONTENT_CACHE, StaticContentCache } from "./static-content-cache";
import {
  DrizzleSupplierAccountsSource,
  SUPPLIER_ACCOUNTS_SOURCE,
  type SupplierAccountsSource,
} from "./supplier-accounts";

/** Closes the Redis connection on shutdown (enableShutdownHooks). */
class SearchCacheLifecycle implements OnApplicationShutdown {
  constructor(@Inject(SEARCH_CACHE) private readonly cache: SearchCache) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.cache instanceof RedisSearchCache) {
      await this.cache.close();
    }
  }
}

@Module({
  imports: [ConfigModule, OffersModule, PricingModule, TenantDbModule],
  controllers: [HotelSearchController],
  providers: [
    {
      provide: SUPPLIER_ACCOUNTS_SOURCE,
      inject: [TENANT_DB_RESOLVER],
      useFactory: (resolver: TenantDbResolver) => new DrizzleSupplierAccountsSource(resolver),
    },
    {
      // Lazy-connecting Redis (REDIS_URL, docker-compose): a down Redis
      // degrades to cache misses, never to failed searches.
      provide: SEARCH_CACHE,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => new RedisSearchCache(config.redisUrl),
    },
    SearchCacheLifecycle,
    {
      // Per-tenant TTL settings bind here when the tenant-settings surface
      // lands; the fixed default keeps every tenant on the platform-safe
      // short TTL, and the cache clamps ANY source to its bounds.
      provide: SEARCH_CACHE_TTL_SOURCE,
      useFactory: () => new FixedSearchCacheTtlSource(),
    },
    {
      provide: AVAILABILITY_CACHE,
      inject: [SEARCH_CACHE, SEARCH_CACHE_TTL_SOURCE],
      useFactory: (cache: SearchCache, ttl: SearchCacheTtlSource) =>
        new AvailabilityCache(cache, ttl),
    },
    {
      provide: STATIC_CONTENT_CACHE,
      inject: [SEARCH_CACHE],
      useFactory: (cache: SearchCache) => new StaticContentCache(cache),
    },
    {
      provide: HOTEL_SEARCH_SERVICE,
      inject: [
        SUPPLIER_REGISTRY,
        SUPPLIER_ACCOUNTS_SOURCE,
        SUPPLIER_CREDENTIALS_SOURCE,
        PRICING_SERVICE,
        OFFERS_SERVICE,
        AVAILABILITY_CACHE,
        API_CONFIG,
      ],
      useFactory: (
        registry: SupplierRegistry,
        accounts: SupplierAccountsSource,
        credentials: SupplierCredentialsSource,
        pricing: PricingService,
        offers: OffersService,
        availabilityCache: AvailabilityCache,
        config: ApiConfig,
      ) =>
        new HotelSearchService(registry, accounts, credentials, pricing, offers, {
          budgetMs: config.hotelSearchBudgetMs,
          availabilityCache,
        }),
    },
  ],
  exports: [
    HOTEL_SEARCH_SERVICE,
    SUPPLIER_ACCOUNTS_SOURCE,
    SEARCH_CACHE,
    AVAILABILITY_CACHE,
    STATIC_CONTENT_CACHE,
  ],
})
export class HotelSearchModule {}
