/**
 * Seed the core-workspace e2e tenant with REAL recorded bookings (M2 #92):
 * fares and normalized policies come from the committed SNAO7U BookingDetail
 * recording through the real TBO adapter in replay mode, and every state
 * change runs through the state-machine runner (ledger + audit + outbox) —
 * no fabricated supplier data, no side-door writes (CLAUDE.md rules 5/7).
 *
 * Creates: one CONFIRMED booking (list/detail evidence) and N escalated
 * pending_confirmation items (manual-intervention queue evidence; a forced
 * retry settles them against the same recording).
 *
 *   pnpm --filter @jenova/api exec tsx tools/seed-workspace-booking.ts \
 *     --tenant-slug <slug> [--escalations 2]
 *
 * Requires CONTROL_PLANE_DATABASE_URL, JENOVA_TENANT_RUNTIME_DSN and
 * NODE_ENV=test (replay transport) in the environment.
 */

import { eq } from "drizzle-orm";
import { connectControlPlane, createTenantDbResolver, tenants } from "@jenova/db";
import { BookingTransitionRunner, type AuditActor } from "@jenova/booking-engine";
import { createSupplierRegistry, type SupplierCredentialsSource } from "@jenova/supplier-registry";
import type { AdapterCallContext } from "@jenova/supplier-sdk";

const RECORDED_CONFIRMED_REF = "SNAO7U";
const ACTOR: AuditActor = { actorType: "system", actorId: "e2e-seed" };

const replayCredentials: SupplierCredentialsSource = {
  credentialsFor: (tenant, supplierCode) =>
    Promise.resolve({
      tenantId: tenant,
      supplierCode,
      environment: "sandbox",
      secrets: {
        apiUrl: "https://api.tbotechnology.in/TBOHolidays_HotelAPI",
        username: "replay",
        password: "replay",
      },
    }),
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const slug = arg("tenant-slug");
  const escalations = Number(arg("escalations") ?? "2");
  const controlPlaneUrl = process.env["CONTROL_PLANE_DATABASE_URL"];
  if (slug === undefined || controlPlaneUrl === undefined) {
    throw new Error("usage: seed-workspace-booking --tenant-slug <slug> [--escalations N] (CONTROL_PLANE_DATABASE_URL required)");
  }

  const controlPlane = connectControlPlane({ url: controlPlaneUrl });
  const resolver = createTenantDbResolver(controlPlane);
  try {
    const tenantRows = await controlPlane.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);
    const tenant = tenantRows[0]?.id;
    if (tenant === undefined) throw new Error(`no tenant with slug '${slug}'`);

    const registry = createSupplierRegistry({ mode: "replay" });
    const adapter = registry.hotelAdapter("tbo");
    if (adapter === null) throw new Error("tbo adapter missing from the registry");
    const ctx: AdapterCallContext = {
      credentials: await replayCredentials.credentialsFor(tenant, "tbo"),
      deadline: new Date(Date.now() + 25_000),
      nationality: "SA",
      currency: "USD",
      locale: "en",
    };
    const record = await adapter.retrieve(ctx, RECORDED_CONFIRMED_REF);

    const runner = new BookingTransitionRunner(resolver);
    const seedItem = async (
      reference: string,
      final: "confirmed" | "pending_confirmation",
      reason?: string,
    ): Promise<string> => {
      const created = await runner.createHotelBooking(tenant, {
        clientReference: reference,
        channel: "internal",
        agencyId: null,
        supplierCode: "tbo",
        vertical: "hotel",
        offerId: null,
        net: record.net,
        sell: record.net,
        policySnapshot: record.cancellationPolicy,
        actor: ACTOR,
      });
      await runner.transition(tenant, created.item.id, "reserved", {
        expectedFrom: "quoted",
        actor: ACTOR,
        reason: "e2e seed",
      });
      await runner.transition(tenant, created.item.id, final, {
        expectedFrom: "reserved",
        actor: ACTOR,
        reason: "e2e seed",
        patch: {
          supplierReference: RECORDED_CONFIRMED_REF,
          ...(final === "pending_confirmation" ? { pendingSince: new Date() } : {}),
        },
      });
      if (reason !== undefined) {
        await runner.escalate(tenant, created.item.id, ACTOR, reason);
      }
      return created.item.id;
    };

    await seedItem(`E2E-CONFIRMED-${Date.now().toString(36)}`, "confirmed");
    for (let index = 0; index < escalations; index += 1) {
      await seedItem(
        `E2E-ESCALATED-${String(index)}-${Date.now().toString(36)}`,
        "pending_confirmation",
        "confirmation wait exceeded the max pending age — manual intervention required",
      );
    }
    console.log(`seeded 1 confirmed booking + ${String(escalations)} escalated items for ${slug}`);
  } finally {
    await resolver.close();
    await controlPlane.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
