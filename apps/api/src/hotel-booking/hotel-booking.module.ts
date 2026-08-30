/**
 * Hotel booking engine module (issues #66/#67): the state-machine runner
 * (from @jenova/booking-engine — shared with the worker) wired to the api's
 * offer gate, supplier registry and tenant resolver.
 */

import { Module } from "@nestjs/common";
import { BookingTransitionRunner, NoopEventSink } from "@jenova/booking-engine";
import type { TenantDbResolver } from "@jenova/db";
import type { SupplierCredentialsSource, SupplierRegistry } from "@jenova/supplier-registry";
import { SUPPLIER_CREDENTIALS_SOURCE, SUPPLIER_REGISTRY } from "@jenova/supplier-registry";
import { OffersModule } from "../offers/offers.module";
import { OFFERS_SERVICE, type OffersService } from "../offers/offers.service";
import { TENANT_DB_RESOLVER, TenantDbModule } from "../tenancy/tenant-db.module";
import { HotelBookingController } from "./booking.controller";
import {
  BOOKING_TRANSITION_RUNNER,
  HOTEL_BOOKING_SERVICE,
  HotelBookingService,
} from "./booking.service";

@Module({
  imports: [OffersModule, TenantDbModule],
  controllers: [HotelBookingController],
  providers: [
    {
      // In-process event sink only at M1 (webhooks/notifications subscribe
      // from M4); unpublished outbox rows are re-dispatched by the worker.
      provide: BOOKING_TRANSITION_RUNNER,
      inject: [TENANT_DB_RESOLVER],
      useFactory: (resolver: TenantDbResolver) =>
        new BookingTransitionRunner(resolver, new NoopEventSink()),
    },
    {
      provide: HOTEL_BOOKING_SERVICE,
      inject: [
        TENANT_DB_RESOLVER,
        OFFERS_SERVICE,
        SUPPLIER_REGISTRY,
        SUPPLIER_CREDENTIALS_SOURCE,
        BOOKING_TRANSITION_RUNNER,
      ],
      useFactory: (
        resolver: TenantDbResolver,
        offers: OffersService,
        registry: SupplierRegistry,
        credentials: SupplierCredentialsSource,
        runner: BookingTransitionRunner,
      ) => new HotelBookingService(resolver, offers, registry, credentials, runner),
    },
  ],
  exports: [HOTEL_BOOKING_SERVICE, BOOKING_TRANSITION_RUNNER],
})
export class HotelBookingModule {}
