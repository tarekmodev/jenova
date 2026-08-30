/**
 * M2 documents proof (issues #99/#100): the confirm-event → worker →
 * PDF-in-MinIO → mailpit-inbox flow, end to end, against the REAL compose
 * services (minio + mailpit) on a REAL throwaway tenant database — with the
 * supplier side REPLAYED from the committed recordings of the live TBO
 * certification booking (LVFXI5). No live supplier calls (look-to-book is a
 * commercial obligation); everything after the adapter boundary is real.
 *
 *   docker compose up -d postgres minio mailpit
 *   (create the bucket once: mc mb local/jenova-dev)
 *   pnpm --filter @jenova/api exec tsx tools/voucher-delivery-proof.ts
 *
 * Prints the delivery report, the MinIO object, and the mailpit message; it
 * also saves the emailed PDF next to this script's --out target (default
 * ./voucher-proof.pdf) so the Arabic rendering can be inspected by eye.
 */

import { writeFileSync } from "node:fs";
import { resolvePenaltyAt, type TenantId } from "@jenova/domain";
import { createTenantDatabase, createTenantDbResolver, tenants } from "@jenova/db";
import { createTestPlatform } from "@jenova/db/testing";
import { BookingTransitionRunner } from "@jenova/booking-engine";
import { createSupplierRegistry, type SupplierCredentialsSource } from "@jenova/supplier-registry";
import type { AdapterCallContext } from "@jenova/supplier-sdk";
import {
  DocumentsService,
  S3DocumentStore,
  SmtpMailSender,
  StaticPropertyNameSource,
  TypstRenderer,
  VoucherDeliveryConsumer,
} from "@jenova/documents";
import { assemblePricedOffer } from "../src/pricing/offer";
import { resolvePrice } from "../src/pricing/resolve";
import type { PricingContext } from "../src/pricing/rules";
import { DrizzleOfferStore } from "../src/offers/offer-store";
import { FixedOfferTtlSource, OffersService } from "../src/offers/offers.service";
import { HotelBookingService } from "../src/hotel-booking/booking.service";

const OUT_PDF =
  process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) ??
  "voucher-proof.pdf";
const MAILPIT_API = process.env["MAILPIT_API"] ?? "http://localhost:8025";

// --- Recorded lifecycle request data (recorded-scenarios.ts, duplicated) ---
const RECORDED_SEARCH_QUERY = {
  target: {
    kind: "properties" as const,
    canonicalPropertyIds: [
      "tbo:1010062",
      "tbo:1032860",
      "tbo:1037420",
      "tbo:1065918",
      "tbo:1065929",
      "tbo:1065933",
      "tbo:1065937",
      "tbo:1065954",
      "tbo:1077182",
      "tbo:1087447",
    ],
  },
  checkIn: "2026-10-13",
  checkOut: "2026-10-14",
  rooms: [{ adults: 1, childAges: [] as number[] }],
};
const RECORDED_SEARCH_INSTANT = "2026-08-30T16:00:00Z";
const RECORDED_CLIENT_REFERENCE = "JENOVA-M1-TBO-CERT-0001";
const RECORDED_HOLDER = {
  firstName: "Jenova",
  lastName: "Certification",
  email: "jenova.certification@example.com",
  phone: "966555000000",
};
const RECORDED_ROOMS = [{ guests: [{ firstName: "Jenova", lastName: "Certification" }] }];
/** Byte-matches the recorded TBOHotelCodeList entry for HotelCode 1065918. */
const RECORDED_PROPERTY_NAMES = { "tbo:1065918": "Comfort Inn Taawn" };
// ---------------------------------------------------------------------------

const SIGNING_KEY = "docs-proof-offer-signing-key-0123456789ab";
const CONTEXT: PricingContext = {
  subTenantId: null,
  channel: "b2b",
  vertical: "hotel",
  supplierCode: "tbo",
  destination: null,
  travelDate: RECORDED_SEARCH_QUERY.checkIn,
  nights: 1,
  paxCount: 1,
};
const ACTOR = { actorType: "system" as const, actorId: "proof:m2-documents" };

class ReplayCredentialsSource implements SupplierCredentialsSource {
  credentialsFor(tenant: TenantId, supplierCode: string) {
    return Promise.resolve({
      tenantId: tenant,
      supplierCode,
      environment: "sandbox" as const,
      secrets: {
        apiUrl: "https://api.tbotechnology.in/TBOHolidays_HotelAPI",
        username: "replay",
        password: "replay",
      },
    });
  }
}

async function main(): Promise<void> {
  const platform = await createTestPlatform();
  const resolver = createTenantDbResolver(platform.controlPlane, {
    runtimeDsn: platform.runtimeDsn,
    connectionsPerTenant: 4,
  });
  platform.registerCleanup(() => resolver.close());
  try {
    const slug = `docsproof_${platform.suffix}`;
    const [row] = await platform.controlPlane.db
      .insert(tenants)
      .values({
        slug,
        name: "Jenova Docs Proof",
        baseCurrency: "SAR",
        branding: { legalName: "وكالة رحلة للسفر والسياحة — Rahala Travel", brandColor: "#1f4e79" },
      })
      .returning({ id: tenants.id });
    if (row === undefined) throw new Error("tenant insert returned no row");
    const tenant = row.id;
    const provisioned = await createTenantDatabase(platform.controlPlane, slug);
    platform.registerDb(provisioned.dbName);
    console.log(`[proof] tenant ${tenant} on ${provisioned.dbName}`);

    // --- Replay the recorded certification booking through the REAL engine.
    const offers = new OffersService(
      new DrizzleOfferStore(resolver),
      new FixedOfferTtlSource(),
      SIGNING_KEY,
    );
    const registry = createSupplierRegistry({ mode: "replay" });
    const runner = new BookingTransitionRunner(resolver);
    const credentials = new ReplayCredentialsSource();
    const bookingService = new HotelBookingService(resolver, offers, registry, credentials, runner);
    const adapter = registry.hotelAdapter("tbo");
    if (adapter === null) throw new Error("tbo adapter missing");
    const ctx: AdapterCallContext = {
      credentials: await credentials.credentialsFor(tenant, "tbo"),
      deadline: new Date(Date.now() + 40_000),
      nationality: "SA",
      currency: "SAR",
      locale: "en",
    };
    const results = await adapter.search(ctx, RECORDED_SEARCH_QUERY);
    const at = new Date(RECORDED_SEARCH_INSTANT);
    const picked = [...results]
      .filter((offer) => {
        if (!offer.cancellationPolicy.refundable) return false;
        const penalty = resolvePenaltyAt(offer.cancellationPolicy, at);
        return penalty === undefined || penalty.amount === 0;
      })
      .sort((a, b) => a.net.amount - b.net.amount)[0];
    if (picked === undefined) throw new Error("no lifecycle rate in the recording");
    const checked = await adapter.check(ctx, picked.supplierOfferToken);
    const priced = assemblePricedOffer(
      {
        supplierCode: "tbo",
        vertical: "hotel",
        policySnapshot: checked.cancellationPolicy,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
      resolvePrice(checked.net, CONTEXT, []),
    );
    const issued = await offers.issueOffer(tenant, {
      offer: priced,
      supplierOfferToken: checked.supplierOfferToken,
      canonicalPropertyId: checked.canonicalPropertyId,
      nationality: "SA",
      occupancy: [{ adults: 1, childAges: [] }],
      pricingContext: CONTEXT,
      boardBasis: checked.boardBasis,
      supplierRoomName: checked.supplierRoomName,
    });
    await offers.markChecked(tenant, issued.offerId);
    const booked = await bookingService.bookHotel(tenant, {
      offerToken: issued.offerToken,
      clientReference: RECORDED_CLIENT_REFERENCE,
      holder: RECORDED_HOLDER,
      rooms: RECORDED_ROOMS,
      channel: "b2b",
      subTenantId: null,
      actor: ACTOR,
    });
    console.log(
      `[proof] booked ${booked.bookingId} state=${booked.state} ref=${String(booked.supplierReference)}`,
    );
    if (booked.state !== "confirmed") throw new Error("expected a confirmed replayed booking");

    // --- The worker's consumer, wired to the REAL compose services.
    const store = new S3DocumentStore({
      endpoint: process.env["S3_ENDPOINT"] ?? "http://localhost:9000",
      region: process.env["S3_REGION"] ?? "me-south-1",
      accessKeyId: process.env["S3_ACCESS_KEY_ID"] ?? "jenova",
      secretAccessKey: process.env["S3_SECRET_ACCESS_KEY"] ?? "jenova-minio",
      bucket: process.env["S3_BUCKET"] ?? "jenova-dev",
      forcePathStyle: true,
    });
    const documents = new DocumentsService({
      resolver,
      controlPlane: platform.controlPlane,
      store,
      renderer: new TypstRenderer(
        process.env["DOCUMENTS_TYPST_BIN"] === undefined
          ? {}
          : { bin: process.env["DOCUMENTS_TYPST_BIN"] },
      ),
      propertyNames: new StaticPropertyNameSource(RECORDED_PROPERTY_NAMES),
    });
    const consumer = new VoucherDeliveryConsumer({
      resolver,
      documents,
      mail: new SmtpMailSender({
        host: process.env["SMTP_HOST"] ?? "localhost",
        port: Number(process.env["SMTP_PORT"] ?? "1025"),
        from: process.env["MAIL_FROM"] ?? "vouchers@jenova.local",
      }),
      runner,
    });
    const report = await consumer.sweepTenant(tenant);
    console.log(`[proof] delivery sweep:`, report);
    if (report.sent !== 1) throw new Error("expected exactly one delivery");

    // --- Verify the artifact IS in MinIO.
    const key = `tenants/${tenant}/documents/hotel-voucher/${booked.bookingItemId}.ar.pdf`;
    const stored = await store.get(key);
    if (stored === null) throw new Error(`no object in MinIO under ${key}`);
    console.log(
      `[proof] MinIO object ${key}: ${String(stored.byteLength)} bytes, ` +
        `magic=${Buffer.from(stored.subarray(0, 5)).toString("latin1")}`,
    );

    // --- Verify the mail IS in the mailpit inbox, voucher attached.
    const inbox = (await (await fetch(`${MAILPIT_API}/api/v1/messages`)).json()) as {
      messages: readonly { ID: string; Subject: string; To: readonly { Address: string }[]; Attachments: number }[];
    };
    const message = inbox.messages.find((m) =>
      m.To.some((to) => to.Address === RECORDED_HOLDER.email),
    );
    if (message === undefined) throw new Error("no message for the holder in mailpit");
    console.log(
      `[proof] mailpit message ${message.ID}: to=${message.To[0]?.Address ?? "?"} ` +
        `attachments=${String(message.Attachments)}\n[proof]   subject: ${message.Subject}`,
    );
    const detail = (await (
      await fetch(`${MAILPIT_API}/api/v1/message/${message.ID}`)
    ).json()) as { Attachments: readonly { PartID: string; FileName: string }[]; Text: string };
    const part = detail.Attachments[0];
    if (part === undefined) throw new Error("mailpit message has no attachment");
    const pdf = new Uint8Array(
      await (
        await fetch(`${MAILPIT_API}/api/v1/message/${message.ID}/part/${part.PartID}`)
      ).arrayBuffer(),
    );
    writeFileSync(OUT_PDF, pdf);
    console.log(
      `[proof] attachment ${part.FileName} (${String(pdf.byteLength)} bytes) saved to ${OUT_PDF}`,
    );
    console.log(`[proof] email text begins:\n${detail.Text.split("\n").slice(0, 6).join("\n")}`);
    console.log("[proof] OK — confirm event → worker → MinIO + mailpit, voucher delivered.");
  } finally {
    await platform.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
