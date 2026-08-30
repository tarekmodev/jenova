/**
 * Agency-realm auth endpoints for the Agent Portal (M2 issue #95).
 *
 * A SEPARATE module from the core AuthModule on purpose: AuthModule stays
 * the realm-agnostic primitive layer (sessions, machine keys, password
 * functions); realm-specific login surfaces mount in their own clearly named
 * modules so parallel workstreams (tenant_staff dashboard login, platform
 * login) never collide in one file.
 */

import { Module } from "@nestjs/common";
import type { TenantDbResolver } from "@jenova/db";
import { TENANT_DB_RESOLVER, TenantDbModule } from "../tenancy/tenant-db.module";
import { AgencyAuthController } from "./agency-auth.controller";
import { AGENCY_USER_DIRECTORY, AgencyUserDirectory } from "./agency-users";
import { AuthModule } from "./auth.module";

@Module({
  imports: [AuthModule, TenantDbModule],
  controllers: [AgencyAuthController],
  providers: [
    {
      provide: AGENCY_USER_DIRECTORY,
      inject: [TENANT_DB_RESOLVER],
      useFactory: (resolver: TenantDbResolver) => new AgencyUserDirectory(resolver),
    },
  ],
})
export class AgencyAuthModule {}
