/**
 * Hotel content module (M2 issue #96). Reuses the ONE process-wide registry,
 * credentials source, accounts source and static-content cache exported by
 * the offers/search modules — nothing here opens its own doors.
 */

import { Module } from "@nestjs/common";
import {
  SUPPLIER_CREDENTIALS_SOURCE,
  SUPPLIER_REGISTRY,
  type SupplierCredentialsSource,
  type SupplierRegistry,
} from "@jenova/supplier-registry";
import { HotelSearchModule } from "../hotel-search/hotel-search.module";
import {
  STATIC_CONTENT_CACHE,
  type StaticContentCache,
} from "../hotel-search/static-content-cache";
import {
  SUPPLIER_ACCOUNTS_SOURCE,
  type SupplierAccountsSource,
} from "../hotel-search/supplier-accounts";
import { OffersModule } from "../offers/offers.module";
import { HotelContentController } from "./content.controller";
import { HOTEL_CONTENT_SERVICE, HotelContentService } from "./content.service";

@Module({
  imports: [OffersModule, HotelSearchModule],
  controllers: [HotelContentController],
  providers: [
    {
      provide: HOTEL_CONTENT_SERVICE,
      inject: [
        SUPPLIER_REGISTRY,
        SUPPLIER_ACCOUNTS_SOURCE,
        SUPPLIER_CREDENTIALS_SOURCE,
        STATIC_CONTENT_CACHE,
      ],
      useFactory: (
        registry: SupplierRegistry,
        accounts: SupplierAccountsSource,
        credentials: SupplierCredentialsSource,
        cache: StaticContentCache,
      ) => new HotelContentService(registry, accounts, credentials, cache),
    },
  ],
})
export class HotelContentModule {}
