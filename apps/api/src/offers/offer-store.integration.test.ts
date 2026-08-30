/**
 * Offer store service tests against REAL per-tenant Postgres databases via
 * the @jenova/db harness (throwaway control-plane + provisioned tenant DBs
 * on the docker-compose / CI service container; skipped loudly when
 * Postgres is down).
 *
 * All rows are ABSTRACT structural values run through the real pricing
 * engine — no fabricated supplier data (CLAUDE.md rule 5).
 */

import { eq } from "drizzle-orm";
import { money, type TenantId } from "@jenova/domain";
import {
  createTenantDatabase,
  createTenantDbResolver,
  offers,
  tenants,
  type TenantDbResolver,
} from "@jenova/db";
import { createTestPlatform, pgAvailable, type TestPlatform } from "@jenova/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assemblePricedOffer } from "../pricing/offer";
import { resolvePrice } from "../pricing/resolve";
import type { PricingContext } from "../pricing/rules";
import { DrizzleOfferStore } from "./offer-store";
import { FixedOfferTtlSource, OffersService, type IssueOfferInput } from "./offers.service";

const KEY = "integration-test-signing-key-0123456789";

const CONTEXT: PricingContext = {
  subTenantId: null,
  channel: "b2b",
  vertical: "hotel",
  supplierCode: "sup-a",
  destination: null,
  travelDate: null,
  nights: 3,
  paxCount: 2,
};

function issueInput(expiresAt: Date, supplierOfferToken = "opaque-token-1"): IssueOfferInput {
  const resolution = resolvePrice(money(123_456, "SAR"), CONTEXT, []);
  return {
    offer: assemblePricedOffer(
      { supplierCode: "sup-a", vertical: "hotel", policySnapshot: { refundable: false, rules: [{ fromUtc: "2026-09-01T00:00:00.000Z", penalty: money(123_456, "SAR") }] }, expiresAt },
      resolution,
    ),
    supplierOfferToken,
    canonicalPropertyId: "prop-1",
    nationality: "SA",
    occupancy: [{ adults: 2, childAges: [4] }],
    pricingContext: CONTEXT,
  };
}

const available = await pgAvailable();

describe.skipIf(!available)("DrizzleOfferStore + OffersService on tenant Postgres", () => {
  let platform: TestPlatform;
  let resolver: TenantDbResolver;
  let tenant: TenantId;
  let store: DrizzleOfferStore;
  let service: OffersService;

  beforeAll(async () => {
    platform = await createTestPlatform();
    resolver = createTenantDbResolver(platform.controlPlane, {
      runtimeDsn: platform.runtimeDsn,
      connectionsPerTenant: 2,
    });
    platform.registerCleanup(() => resolver.close());

    const slug = `offers_${platform.suffix}`;
    const [row] = await platform.controlPlane.db
      .insert(tenants)
      .values({ slug, name: slug, baseCurrency: "SAR" })
      .returning({ id: tenants.id });
    if (row === undefined) throw new Error("tenant insert returned no row");
    tenant = row.id;

    const provisioned = await createTenantDatabase(platform.controlPlane, slug);
    platform.registerDb(provisioned.dbName);
    // The offer-store columns must ride the fan-out like every migration.
    expect(provisioned.migrationsApplied).toContain("0003_offer_store.sql");

    store = new DrizzleOfferStore(resolver);
    service = new OffersService(store, new FixedOfferTtlSource(), KEY);
  }, 60_000);

  afterAll(async () => {
    await platform.destroy();
  });

  it("issues, persists and verifies an offer round-trip through the real row", async () => {
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const issued = await service.issueOffer(tenant, issueInput(expiresAt));

    const verified = await service.verifyOfferToken(tenant, issued.offerToken);
    expect(verified.sell).toEqual(money(123_456, "SAR"));
    expect(verified.net).toEqual(money(123_456, "SAR"));
    expect(verified.supplierOfferToken).toBe("opaque-token-1");
    expect(verified.canonicalPropertyId).toBe("prop-1");
    expect(verified.nationality).toBe("SA");
    expect(verified.occupancy).toEqual([{ adults: 2, childAges: [4] }]);
    expect(verified.policySnapshot?.refundable).toBe(false);
    expect(verified.breakdown.vat.currency).toBe("SAR");
    expect(verified.pricingContext).toEqual(CONTEXT);
    expect(verified.expiresAt.getTime()).toBe(expiresAt.getTime());
    expect(verified.checkedAt).toBeNull();
    expect(verified.invalidatedAt).toBeNull();
  });

  it("a row whose amounts are rewritten in the database no longer verifies", async () => {
    const issued = await service.issueOffer(tenant, issueInput(new Date(Date.now() + 5 * 60_000)));
    const db = await resolver.getTenantDb(tenant);
    // At-rest tampering: rewrite the sell amount behind the signature's back.
    await db.update(offers).set({ sellAmount: 1n }).where(eq(offers.id, issued.offerId));

    await expect(service.verifyOfferToken(tenant, issued.offerToken)).rejects.toMatchObject({
      kind: "offer_not_found",
    });
  });

  it("markChecked stamps and invalidate withdraws — idempotently", async () => {
    const issued = await service.issueOffer(tenant, issueInput(new Date(Date.now() + 5 * 60_000)));
    await service.markChecked(tenant, issued.offerId);
    const checked = await service.requireBookableOffer(tenant, issued.offerToken);
    expect(checked.checkedAt).not.toBeNull();

    await service.invalidateOffer(tenant, issued.offerId);
    await service.invalidateOffer(tenant, issued.offerId); // second call: no-op
    await expect(service.verifyOfferToken(tenant, issued.offerToken)).rejects.toMatchObject({
      kind: "offer_invalidated",
    });
  });

  it("supersede atomically invalidates the old offer and persists the successor", async () => {
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const issued = await service.issueOffer(tenant, issueInput(expiresAt));
    const replacement = service.buildRecord(tenant, issueInput(expiresAt, "opaque-token-2"), new Date());
    await expect(service.supersedeOffer(tenant, issued.offerId, replacement)).resolves.toBe(true);

    await expect(service.verifyOfferToken(tenant, issued.offerToken)).rejects.toMatchObject({
      kind: "offer_invalidated",
    });
    const successor = await service.verifyOfferToken(tenant, service.tokenFor(replacement));
    expect(successor.supplierOfferToken).toBe("opaque-token-2");
    expect(successor.checkedAt).not.toBeNull();
  });

  it("two RACING supersedes mint exactly one bookable successor (review MEDIUM-1)", async () => {
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const issued = await service.issueOffer(tenant, issueInput(expiresAt));
    const a = service.buildRecord(tenant, issueInput(expiresAt, "racer-token-a"), new Date());
    const b = service.buildRecord(tenant, issueInput(expiresAt, "racer-token-b"), new Date());

    // Two concurrent transactions contend for the same old row: the claim
    // (conditional invalidate, rowcount-gated) must admit exactly one.
    const [claimedA, claimedB] = await Promise.all([
      service.supersedeOffer(tenant, issued.offerId, a),
      service.supersedeOffer(tenant, issued.offerId, b),
    ]);
    expect([claimedA, claimedB].filter(Boolean)).toHaveLength(1);

    const winner = claimedA ? a : b;
    const loser = claimedA ? b : a;
    await expect(service.requireBookableOffer(tenant, service.tokenFor(winner))).resolves.toBeDefined();
    // The loser inserted NOTHING — its would-be token addresses no row.
    await expect(service.verifyOfferToken(tenant, service.tokenFor(loser))).rejects.toMatchObject({
      kind: "offer_not_found",
    });
    await expect(service.verifyOfferToken(tenant, issued.offerToken)).rejects.toMatchObject({
      kind: "offer_invalidated",
    });
  });
});
