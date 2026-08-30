/**
 * Documents module (M2 issue #99): wires @jenova/documents — Typst voucher
 * rendering, the S3/MinIO object-store seam, and the agency-realm re-download
 * endpoint. When no S3 block is configured the service token resolves to
 * null and the endpoint answers `documents_unavailable` — the api still
 * boots (dashboards and booking flows do not depend on documents).
 */

import { Module } from "@nestjs/common";
import type { ControlPlaneClient, TenantDbResolver } from "@jenova/db";
import { DocumentsService, S3DocumentStore, TypstRenderer } from "@jenova/documents";
import { API_CONFIG, type ApiConfig } from "../config/config";
import { ConfigModule } from "../config/config.module";
import {
  CONTROL_PLANE_CLIENT,
  TENANT_DB_RESOLVER,
  TenantDbModule,
} from "../tenancy/tenant-db.module";
import { HotelBookingModule } from "../hotel-booking/hotel-booking.module";
import { DOCUMENTS_SERVICE } from "./documents.tokens";

export { DOCUMENTS_SERVICE } from "./documents.tokens";

@Module({
  imports: [ConfigModule, TenantDbModule, HotelBookingModule],
  providers: [
    {
      provide: DOCUMENTS_SERVICE,
      inject: [API_CONFIG, TENANT_DB_RESOLVER, CONTROL_PLANE_CLIENT],
      useFactory: (
        config: ApiConfig,
        resolver: TenantDbResolver,
        controlPlane: ControlPlaneClient,
      ): DocumentsService | null => {
        if (config.documents === null) {
          return null;
        }
        return new DocumentsService({
          resolver,
          controlPlane,
          store: new S3DocumentStore(config.documents.s3),
          renderer: new TypstRenderer({ bin: config.documents.typstBin }),
        });
      },
    },
  ],
  exports: [DOCUMENTS_SERVICE],
})
export class DocumentsModule {}
