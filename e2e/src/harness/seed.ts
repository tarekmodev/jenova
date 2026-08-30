/**
 * Per-run tenant provisioning + structural seeds for the portal flow.
 *
 * NO fabricated business data (CLAUDE.md rule 5): everything inserted here
 * is the minimal STRUCTURAL state the flow needs — a tenant, its domain
 * binding, one agency with a portal user (our own test credential), and an
 * enabled TBO supplier-account row. The supplier secrets blob is a
 * placeholder because the api's test wiring resolves replay credentials
 * without ever reading it (replay resolves recordings by fingerprint).
 */

import { hash as argon2Hash, argon2id } from "argon2";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  agencies,
  agencyUsers,
  createTenantDatabase,
  supplierAccounts,
  tenantDomains,
  tenants,
} from "@jenova/db";
import { TEST_PG_URL, type TestPlatform } from "@jenova/db/testing";
import { AGENCY_NAME, AGENT_EMAIL, AGENT_PASSWORD } from "./constants";

export interface SeededTenant {
  readonly slug: string;
  readonly host: string;
}

export async function seedTenantForHost(
  platform: TestPlatform,
  slugPrefix: string,
  host: string,
): Promise<SeededTenant> {
  const slug = `${slugPrefix}_${platform.suffix}`;
  const [tenantRow] = await platform.controlPlane.db
    .insert(tenants)
    .values({ slug, name: `Jenova E2E (${slugPrefix})`, baseCurrency: "USD" })
    .returning({ id: tenants.id });
  if (tenantRow === undefined) {
    throw new Error("tenant insert returned no row");
  }
  const provisioned = await createTenantDatabase(platform.controlPlane, slug);
  platform.registerDb(provisioned.dbName);

  await platform.controlPlane.db
    .insert(tenantDomains)
    .values({ tenantId: tenantRow.id, host });

  // Owner connection to the fresh tenant db for structural seeds.
  const url = new URL(TEST_PG_URL);
  url.pathname = `/${provisioned.dbName}`;
  const sql = postgres(url.toString(), { max: 1 });
  try {
    const db = drizzle(sql);
    const [agency] = await db
      .insert(agencies)
      .values({
        name: AGENCY_NAME,
        allowedCurrencies: ["USD", "SAR"],
        defaultNationality: "SA",
      })
      .returning({ id: agencies.id });
    if (agency === undefined) {
      throw new Error("agency insert returned no row");
    }
    await db.insert(agencyUsers).values({
      agencyId: agency.id,
      email: AGENT_EMAIL,
      displayName: "E2E Agent",
      role: "agent",
      passwordHash: await argon2Hash(AGENT_PASSWORD, {
        // OWASP baseline, same parameters as apps/api auth/password.ts.
        type: argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      }),
    });
    await db.insert(supplierAccounts).values({
      supplierCode: "tbo",
      environment: "sandbox",
      enabled: true,
      // Never read in NODE_ENV=test (replay credentials seam) — structural.
      secretsEncrypted: Buffer.from("e2e-structural-placeholder"),
      secretsKeyId: "e2e-placeholder",
    });
  } finally {
    await sql.end({ timeout: 5 });
  }

  return { slug, host };
}
