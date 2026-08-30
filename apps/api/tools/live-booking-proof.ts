/**
 * M1 acceptance-gate proof (issues #66/#67/#68/#69): ONE deliberate live
 * end-to-end flow against the real TBO sandbox, through the REAL engine
 * services on a REAL throwaway tenant database:
 *
 *   search → check → issue signed offer → bookHotel (offer gate → runner →
 *   adapter book) → retrieve → previewCancellation → cancelBooking →
 *   worker-poller settlement — with ledger postings balanced in the tenant
 *   DB and the AuditEvent/outbox trail printed.
 *
 * Look-to-book discipline: run on purpose, once; the search/check/book/
 * retrieve hops are RECORDED (sanitized → recordings/tbo) so CI replays
 * them forever; the cancel + settlement polls run in live mode so the
 * committed BookingDetail recording keeps the CONFIRMED state the worker
 * suite replays (same fingerprint — a recorded cancel-poll would overwrite
 * it).
 *
 *   pnpm --filter @jenova/api exec tsx tools/live-booking-proof.ts [--keep]
 *
 * --keep leaves the throwaway platform up and prints the env needed to run
 * the real worker (BullMQ) against it for the live sweep demonstration.
 */

import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolvePenaltyAt, type Money, type TenantId } from "@jenova/domain";
import {
  auditEvents,
  bookingEvents,
  bookingItems,
  createTenantDatabase,
  createTenantDbResolver,
  tenants,
} from "@jenova/db";
import { createTestPlatform } from "@jenova/db/testing";
import {
  assertLedgerBalanced,
  BookingTransitionRunner,
  PendingConfirmationPoller,
  trialBalance,
  unbalancedTransactionGroups,
  type AuditActor,
} from "@jenova/booking-engine";
import { createSupplierRegistry, EnvSupplierCredentialsSource } from "@jenova/supplier-registry";
import type { AdapterCallContext, HotelOffer } from "@jenova/supplier-sdk";
import { eq } from "drizzle-orm";
import { assemblePricedOffer } from "../src/pricing/offer";
import { resolvePrice } from "../src/pricing/resolve";
import type { PricingContext } from "../src/pricing/rules";
import { DrizzleOfferStore } from "../src/offers/offer-store";
import { FixedOfferTtlSource, OffersService } from "../src/offers/offers.service";
import { HotelBookingService } from "../src/hotel-booking/booking.service";

// Repo-root .env regardless of cwd (same pattern as the adapter's tools).
const REPO_ROOT_ENV = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(REPO_ROOT_ENV)) process.loadEnvFile(REPO_ROOT_ENV);
const KEEP = process.argv.includes("--keep");

/** Riyadh hotel codes from the recorded TBOHotelCodeList (recorded-scenarios). */
const HOTEL_CODES = [
  "1010062", "1032860", "1037420", "1065918", "1065929",
  "1065933", "1065937", "1065954", "1077182", "1087447",
];
/** Fresh stay window — distinct request fingerprints from the certification
 * recordings, so nothing already committed is overwritten. */
const CHECK_IN = "2026-10-20";
const CHECK_OUT = "2026-10-21";
/** One clientReference, one booking — bump the suffix on any re-run. */
const CLIENT_REFERENCE =
  process.argv.find((arg) => arg.startsWith("--ref="))?.slice("--ref=".length) ??
  "JENOVA-M1-BOOKENG-0001";

const SIGNING_KEY = "live-proof-offer-signing-key-0123456789ab";
const ACTOR: AuditActor = { actorType: "system", actorId: "live-proof:m1-booking" };
const CONTEXT: PricingContext = {
  subTenantId: null,
  channel: "b2b",
  vertical: "hotel",
  supplierCode: "tbo",
  destination: null,
  travelDate: CHECK_IN,
  nights: 1,
  paxCount: 1,
};

function fmt(m: Money | { amount: number | bigint; currency: string }): string {
  return `${String(m.amount)} ${m.currency} (minor units)`;
}

async function main(): Promise<void> {
  const credentials = new EnvSupplierCredentialsSource();
  const recordRegistry = createSupplierRegistry({ mode: "record" });
  const liveRegistry = createSupplierRegistry({ mode: "live" });

  console.log("=== M1 live booking proof — TBO sandbox, real tenant DB ===");
  const platform = await createTestPlatform();
  const resolver = createTenantDbResolver(platform.controlPlane, {
    runtimeDsn: platform.runtimeDsn,
    connectionsPerTenant: 4,
  });
  const slug = `liveproof_${platform.suffix}`;
  const [tenantRow] = await platform.controlPlane.db
    .insert(tenants)
    .values({ slug, name: "M1 live proof tenant", baseCurrency: "SAR" })
    .returning({ id: tenants.id });
  if (tenantRow === undefined) throw new Error("tenant insert failed");
  const tenant: TenantId = tenantRow.id;
  const provisioned = await createTenantDatabase(platform.controlPlane, slug);
  platform.registerDb(provisioned.dbName);
  console.log(`tenant ${tenant} on ${provisioned.dbName} (migrations: ${String(provisioned.migrationsApplied.length)})`);

  const offers = new OffersService(new DrizzleOfferStore(resolver), new FixedOfferTtlSource(), SIGNING_KEY);
  const runner = new BookingTransitionRunner(resolver);
  const bookingService = new HotelBookingService(resolver, offers, recordRegistry, credentials, runner);
  const db = await resolver.getTenantDb(tenant);

  const adapterCtx = async (): Promise<AdapterCallContext> => ({
    credentials: await credentials.credentialsFor(tenant, "tbo"),
    deadline: new Date(Date.now() + 35_000),
    nationality: "SA",
    currency: "SAR",
    locale: "en",
  });
  const recAdapter = recordRegistry.hotelAdapter("tbo");
  if (recAdapter === null || liveRegistry.hotelAdapter("tbo") === null) {
    throw new Error("tbo adapter missing");
  }

  // --- 1. search (recorded) ------------------------------------------------
  console.log(`\n[1] search ${CHECK_IN}→${CHECK_OUT}, ${String(HOTEL_CODES.length)} Riyadh properties, nationality SA`);
  const results = await recAdapter.search(await adapterCtx(), {
    target: { kind: "properties", canonicalPropertyIds: HOTEL_CODES.map((c) => `tbo:${c}`) },
    checkIn: CHECK_IN,
    checkOut: CHECK_OUT,
    rooms: [{ adults: 1, childAges: [] }],
  });
  console.log(`    ${String(results.length)} offers`);
  const now = new Date();
  const refundableNow = results.filter((offer: HotelOffer) => {
    if (!offer.cancellationPolicy.refundable) return false;
    const penalty = resolvePenaltyAt(offer.cancellationPolicy, now);
    return penalty === undefined || penalty.amount === 0;
  });
  const picked = [...refundableNow].sort((a, b) => a.net.amount - b.net.amount)[0];
  if (picked === undefined) throw new Error("no refundable zero-penalty rate available");
  console.log(`    picked ${picked.canonicalPropertyId} "${picked.supplierRoomName}" ${picked.boardBasis} net ${fmt(picked.net)} refundable`);

  // --- 2. check (recorded) -------------------------------------------------
  console.log("[2] check (PreBook)");
  const checked = await recAdapter.check(await adapterCtx(), picked.supplierOfferToken);
  console.log(`    revalidated net ${fmt(checked.net)}; policy rules: ${String(checked.cancellationPolicy.rules.length)}`);

  // --- 3. signed offer -----------------------------------------------------
  const resolution = resolvePrice(checked.net, CONTEXT, []);
  const priced = assemblePricedOffer(
    {
      supplierCode: "tbo",
      vertical: "hotel",
      policySnapshot: checked.cancellationPolicy,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
    resolution,
  );
  const issued = await offers.issueOffer(tenant, {
    offer: priced,
    supplierOfferToken: checked.supplierOfferToken,
    canonicalPropertyId: checked.canonicalPropertyId,
    nationality: "SA",
    occupancy: [{ adults: 1, childAges: [] }],
    pricingContext: CONTEXT,
  });
  await offers.markChecked(tenant, issued.offerId);
  console.log(`[3] signed offer issued + checked (offer ${issued.offerId})`);

  // --- 4. bookHotel through the engine ------------------------------------
  console.log(`[4] bookHotel clientReference=${CLIENT_REFERENCE}`);
  const booked = await bookingService.bookHotel(tenant, {
    offerToken: issued.offerToken,
    clientReference: CLIENT_REFERENCE,
    holder: {
      firstName: "Jenova",
      lastName: "Certification",
      email: "jenova.certification@example.com",
      phone: "966555000000",
    },
    rooms: [{ guests: [{ firstName: "Jenova", lastName: "Certification" }] }],
    channel: "b2b",
    subTenantId: null,
    actor: ACTOR,
  });
  console.log(`    state=${booked.state} supplierRef=${booked.supplierReference ?? "-"} sell=${fmt(booked.sell)}`);

  // Idempotency probe — same clientReference, no supplier call, no 2nd booking.
  const replay = await bookingService.bookHotel(tenant, {
    offerToken: issued.offerToken,
    clientReference: CLIENT_REFERENCE,
    holder: { firstName: "Jenova", lastName: "Certification", email: "jenova.certification@example.com", phone: "966555000000" },
    rooms: [{ guests: [{ firstName: "Jenova", lastName: "Certification" }] }],
    channel: "b2b",
    subTenantId: null,
    actor: ACTOR,
  });
  console.log(`    idempotent retry → replay=${String(replay.idempotentReplay)} same booking=${String(replay.bookingId === booked.bookingId)}`);

  // --- 5. retrieve (recorded — the worker suite replays this) --------------
  const retrieved = await recAdapter.retrieve(await adapterCtx(), booked.supplierReference ?? "");
  console.log(`[5] retrieve → supplier status=${retrieved.status} net=${fmt(retrieved.net)}`);

  // --- 6. ledger + audit after confirm ------------------------------------
  console.log("[6] tenant-DB ledger after confirm:");
  for (const line of await trialBalance(db)) {
    console.log(`    ${line.code.padEnd(28)} ${String(line.balance).padStart(10)} ${line.currency}`);
  }
  const unbalanced = await unbalancedTransactionGroups(db);
  console.log(`    unbalanced groups: ${String(unbalanced.length)}`);
  await assertLedgerBalanced(db);

  // --- 7. cancel through the engine (live mode — see header) ---------------
  const liveBookingService = new HotelBookingService(resolver, offers, liveRegistry, credentials, runner);
  const preview = await liveBookingService.previewCancellation(tenant, booked.bookingId, {
    subTenantId: null,
    actor: ACTOR,
  });
  console.log(`[7] cancellation preview BEFORE execution: penalty=${fmt(preview.penalty)} refund=${preview.refund === null ? "n/a" : fmt(preview.refund)}`);
  const cancelResult = await liveBookingService.cancelBooking(tenant, booked.bookingId, {
    subTenantId: null,
    actor: ACTOR,
  });
  console.log(`    cancel → status=${cancelResult.status} state=${cancelResult.state}`);

  // --- 8. worker-poller settlement (live retrieve) -------------------------
  if (cancelResult.status === "cancellation_pending") {
    const poller = new PendingConfirmationPoller(
      resolver,
      runner,
      async (t, supplierCode, ref) => {
        const adapter = liveRegistry.hotelAdapter(supplierCode);
        if (adapter === null) throw new Error(`no adapter for ${supplierCode}`);
        return adapter.retrieve(await adapterCtx(), ref);
      },
      { baseMs: 30_000, factor: 2, capMs: 600_000, maxPendingAgeMs: 3_600_000 },
    );
    for (let pass = 1; pass <= 6; pass += 1) {
      const report = await poller.pollTenant(tenant);
      const outcome = report.outcomes.find((o) => o.bookingItemId === booked.bookingItemId);
      console.log(`[8] worker poll pass ${String(pass)}: ${outcome?.outcome ?? "not due"}`);
      if (outcome?.outcome === "transitioned_cancelled") break;
      if (pass < 6) await sleep(35_000);
    }
  }

  // --- 9. final state ------------------------------------------------------
  const [finalItem] = await db.select().from(bookingItems).where(eq(bookingItems.id, booked.bookingItemId));
  console.log(`[9] final item state=${finalItem?.state ?? "?"} cancellationRequestedAt=${finalItem?.cancellationRequestedAt?.toISOString() ?? "-"} pollAttempts=${String(finalItem?.pollAttempts ?? 0)}`);
  console.log("    final trial balance:");
  for (const line of await trialBalance(db)) {
    console.log(`    ${line.code.padEnd(28)} ${String(line.balance).padStart(10)} ${line.currency}`);
  }
  await assertLedgerBalanced(db);
  console.log("    ledger invariant: BALANCED");

  const audits = await db.select().from(auditEvents).orderBy(auditEvents.id);
  console.log(`    audit events (${String(audits.length)}):`);
  for (const audit of audits) {
    console.log(`      #${String(audit.id)} [${audit.actorType}:${audit.actorId ?? "-"}] ${audit.entityType} ${audit.action} ${JSON.stringify(audit.after)?.slice(0, 140) ?? ""}`);
  }
  const events = await db.select().from(bookingEvents).orderBy(bookingEvents.occurredAt);
  console.log(`    outbox events (${String(events.length)}):`);
  for (const event of events) {
    console.log(`      ${event.eventType} published=${event.publishedAt === null ? "NO" : "yes"}`);
  }

  if (KEEP) {
    console.log("\n--keep: platform left up for the live worker run:");
    console.log(`  CONTROL_PLANE_DATABASE_URL=${platform.controlPlaneUrl}`);
    console.log(`  JENOVA_TENANT_RUNTIME_DSN=${platform.runtimeDsn}`);
    console.log("  (drop the jenova_test_* databases/role manually when done)");
    await resolver.close();
    await platform.controlPlane.close();
  } else {
    await resolver.close();
    await platform.destroy();
    console.log("\nthrowaway platform destroyed.");
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error(error);
    // Force exit: open pool handles must not keep a failed run alive.
    process.exit(1);
  });
