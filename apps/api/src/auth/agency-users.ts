/**
 * Agency-realm user lookup for the Agent Portal login (M2 issue #95).
 *
 * AGENCY-SCOPED BY CONSTRUCTION: reads only the tenant database's
 * `agency_user` + `agency` rows through the @jenova/db resolver (CLAUDE.md
 * rule 1). The tenant_staff mirror of this lives in its own clearly named
 * files (dashboard workstream) — the two realms never share a user store
 * (docs/08-security.md).
 */

import { eq } from "drizzle-orm";
import { agencies, agencyUsers, type TenantDbResolver } from "@jenova/db";
import type { SubTenantId, TenantId } from "@jenova/domain";

export interface AgencyPortalUser {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: string;
  readonly status: string;
  /** argon2id PHC string; null = credential never set — can never log in. */
  readonly passwordHash: string | null;
  readonly agency: {
    readonly id: SubTenantId;
    readonly name: string;
    readonly status: string;
    readonly defaultNationality: string | null;
    readonly allowedCurrencies: readonly string[];
  };
}

/** Nest injection token for the process-wide {@link AgencyUserDirectory}. */
export const AGENCY_USER_DIRECTORY = Symbol("jenova.api.agencyUserDirectory");

export class AgencyUserDirectory {
  constructor(private readonly resolver: TenantDbResolver) {}

  async findByEmail(tenant: TenantId, email: string): Promise<AgencyPortalUser | null> {
    const db = await this.resolver.getTenantDb(tenant);
    const [row] = await db
      .select({
        userId: agencyUsers.id,
        email: agencyUsers.email,
        displayName: agencyUsers.displayName,
        role: agencyUsers.role,
        status: agencyUsers.status,
        passwordHash: agencyUsers.passwordHash,
        agencyId: agencies.id,
        agencyName: agencies.name,
        agencyStatus: agencies.status,
        defaultNationality: agencies.defaultNationality,
        allowedCurrencies: agencies.allowedCurrencies,
      })
      .from(agencyUsers)
      .innerJoin(agencies, eq(agencyUsers.agencyId, agencies.id))
      .where(eq(agencyUsers.email, email))
      .limit(1);
    if (row === undefined) {
      return null;
    }
    return {
      userId: row.userId,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
      status: row.status,
      passwordHash: row.passwordHash,
      agency: {
        id: row.agencyId,
        name: row.agencyName,
        status: row.agencyStatus,
        defaultNationality: row.defaultNationality,
        allowedCurrencies: row.allowedCurrencies,
      },
    };
  }

  async findById(tenant: TenantId, userId: string): Promise<AgencyPortalUser | null> {
    const db = await this.resolver.getTenantDb(tenant);
    const [row] = await db
      .select({ email: agencyUsers.email })
      .from(agencyUsers)
      .where(eq(agencyUsers.id, userId))
      .limit(1);
    if (row === undefined) {
      return null;
    }
    return this.findByEmail(tenant, row.email);
  }
}
