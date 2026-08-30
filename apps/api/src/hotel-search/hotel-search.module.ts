/**
 * Hotel search & availability module (M1, issues #59/#60/#61;
 * docs/milestones/M01-engine-spine.md "Search & availability service").
 *
 * Every surface searches through HOTEL_SEARCH_SERVICE — per-surface
 * differences (who is buying, which markup applies) are request parameters,
 * never forks (CLAUDE.md rule 2).
 */

import { Module } from "@nestjs/common";
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
import { HOTEL_SEARCH_SERVICE, HotelSearchService } from "./search.service";
import {
  DrizzleSupplierAccountsSource,
  SUPPLIER_ACCOUNTS_SOURCE,
  type SupplierAccountsSource,
} from "./supplier-accounts";

@Module({
  imports: [ConfigModule, OffersModule, PricingModule, TenantDbModule],
  providers: [
    {
      provide: SUPPLIER_ACCOUNTS_SOURCE,
      inject: [TENANT_DB_RESOLVER],
      useFactory: (resolver: TenantDbResolver) => new DrizzleSupplierAccountsSource(resolver),
    },
    {
      provide: HOTEL_SEARCH_SERVICE,
      inject: [
        SUPPLIER_REGISTRY,
        SUPPLIER_ACCOUNTS_SOURCE,
        SUPPLIER_CREDENTIALS_SOURCE,
        PRICING_SERVICE,
        OFFERS_SERVICE,
        API_CONFIG,
      ],
      useFactory: (
        registry: SupplierRegistry,
        accounts: SupplierAccountsSource,
        credentials: SupplierCredentialsSource,
        pricing: PricingService,
        offers: OffersService,
        config: ApiConfig,
      ) =>
        new HotelSearchService(registry, accounts, credentials, pricing, offers, {
          budgetMs: config.hotelSearchBudgetMs,
        }),
    },
  ],
  exports: [HOTEL_SEARCH_SERVICE, SUPPLIER_ACCOUNTS_SOURCE],
})
export class HotelSearchModule {}
