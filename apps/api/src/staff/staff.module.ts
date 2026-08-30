/**
 * Staff settings module (M2 #91): Users & roles, Supplier accounts
 * (write-only credentials + test-connection), Branding. Every surface is
 * tenant_staff-realm and tenant-scoped through the gateway context.
 */

import { Module } from "@nestjs/common";
import { s3ObjectStoreFromEnv } from "@jenova/connectors";
import type { TenantDbResolver } from "@jenova/db";
import { AuthModule } from "../auth/auth.module";
import { ConfigModule } from "../config/config.module";
import { OffersModule } from "../offers/offers.module";
import type { SecretBox } from "../tenancy/secret-box";
import { SECRET_BOX } from "../tenancy/secret-box";
import { TENANT_DB_RESOLVER, TenantDbModule } from "../tenancy/tenant-db.module";
import { BrandingController, OBJECT_STORE } from "./branding.controller";
import { StaffPolicyController, StaffUsersController } from "./staff-users.controller";
import {
  DrizzleSupplierAccountAdmin,
  SUPPLIER_ACCOUNT_ADMIN,
} from "./supplier-account-admin";
import { SupplierAccountsController } from "./supplier-accounts.controller";

@Module({
  imports: [ConfigModule, AuthModule, TenantDbModule, OffersModule],
  controllers: [
    StaffUsersController,
    StaffPolicyController,
    SupplierAccountsController,
    BrandingController,
  ],
  providers: [
    {
      provide: SUPPLIER_ACCOUNT_ADMIN,
      inject: [TENANT_DB_RESOLVER, SECRET_BOX],
      useFactory: (resolver: TenantDbResolver, secrets: SecretBox) =>
        new DrizzleSupplierAccountAdmin(resolver, secrets),
    },
    {
      // .env.example S3_* block (MinIO locally). null = branding logo
      // endpoints answer 503 object_store_unconfigured on use.
      provide: OBJECT_STORE,
      useFactory: () => s3ObjectStoreFromEnv(process.env),
    },
  ],
  exports: [SUPPLIER_ACCOUNT_ADMIN],
})
export class StaffModule {}
