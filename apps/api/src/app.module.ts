/**
 * Root module of the Jenova api (docs/02-architecture.md: one deployable
 * NestJS process; engine modules attach here from M1).
 *
 * DI convention for this app: every injection uses an explicit @Inject(token).
 * We deliberately do NOT rely on emitDecoratorMetadata — vitest (esbuild) and
 * tsx cannot emit it, and explicit tokens keep test and runtime transforms
 * identical.
 */

import { Module } from "@nestjs/common";
import { AgencyAuthModule } from "./auth/agency-auth.module";
import { ConfigModule } from "./config/config.module";
import { DocumentsModule } from "./documents/documents.module";
import { GatewayModule } from "./gateway/gateway.module";
import { HotelBookingModule } from "./hotel-booking/hotel-booking.module";
import { HotelContentModule } from "./hotel-content/hotel-content.module";
import { HotelSearchModule } from "./hotel-search/hotel-search.module";
import { OffersModule } from "./offers/offers.module";
import { PricingModule } from "./pricing/pricing.module";
import { HealthController } from "./health/health.controller";
import { READINESS_CHECKS } from "./health/readiness";
import { HTTP_SERVER_HOOKS, noopHttpServerHooks } from "./observability/instrumentation";

@Module({
  // ConfigModule fails fast (ApiConfigError) before the app can listen.
  // OffersModule provides SUPPLIER_REGISTRY (adapters bind only inside the
  // @jenova/supplier-registry package); HotelSearchModule is the search
  // fan-out (issues #59–#61); HotelBookingModule is the booking engine spine
  // (runner + book/cancel service, issues #66/#67).
  imports: [
    ConfigModule,
    GatewayModule,
    AgencyAuthModule,
    PricingModule,
    OffersModule,
    HotelSearchModule,
    HotelContentModule,
    HotelBookingModule,
    DocumentsModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      // M0: empty set. Control-plane DB / redis checks register here once
      // their clients are wired (after #42).
      provide: READINESS_CHECKS,
      useValue: [],
    },
    {
      // OTel binds here when observability lands; seam only at M0.
      provide: HTTP_SERVER_HOOKS,
      useValue: noopHttpServerHooks,
    },
  ],
})
export class AppModule {}
