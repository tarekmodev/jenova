/**
 * OffersService unit tests (issue #64) — the signed offer store mechanism
 * against the in-memory store with a controlled clock.
 *
 * All values are ABSTRACT structural inputs (integer Money, scope enums,
 * opaque token strings) run through the REAL pricing engine — nothing here
 * imitates a supplier response (CLAUDE.md rule 5).
 */

import { money, subTenantId, type TenantId, tenantId } from "@jenova/domain";
import { describe, expect, it } from "vitest";
import { assemblePricedOffer, type PricedOffer } from "../pricing/offer";
import { resolvePrice } from "../pricing/resolve";
import type { PricingContext } from "../pricing/rules";
import { OfferError } from "./errors";
import { InMemoryOfferStore } from "./offer-store";
import {
  FixedOfferTtlSource,
  MAX_OFFER_TTL_SECONDS,
  MIN_OFFER_TTL_SECONDS,
  OffersService,
  type IssueOfferInput,
} from "./offers.service";

const KEY = "unit-test-signing-key-0123456789abcdef";
const TENANT: TenantId = tenantId("tenant-offers");
const OTHER_TENANT: TenantId = tenantId("tenant-other");
const AGENCY = subTenantId("agency-one");

const T0 = Date.parse("2026-08-30T10:00:00.000Z");

interface Harness {
  readonly store: InMemoryOfferStore;
  readonly service: OffersService;
  readonly clock: { now: number };
}

function harness(options: { bookableWindowSeconds?: number } = {}): Harness {
  const store = new InMemoryOfferStore();
  const clock = { now: T0 };
  const service = new OffersService(store, new FixedOfferTtlSource(), KEY, {
    ...options,
    now: () => new Date(clock.now),
  });
  return { store, service, clock };
}

const CONTEXT: PricingContext = {
  subTenantId: AGENCY,
  channel: "b2b",
  vertical: "hotel",
  supplierCode: "sup-a",
  destination: null,
  travelDate: null,
  nights: 2,
  paxCount: 2,
};

function pricedOffer(expiresAt: Date, netMinor = 50_000): PricedOffer {
  const resolution = resolvePrice(money(netMinor, "SAR"), CONTEXT, []);
  return assemblePricedOffer(
    { supplierCode: "sup-a", vertical: "hotel", policySnapshot: null, expiresAt },
    resolution,
  );
}

function input(expiresAt: Date, overrides: Partial<IssueOfferInput> = {}): IssueOfferInput {
  return {
    offer: pricedOffer(expiresAt),
    supplierOfferToken: "opaque-supplier-token-1",
    canonicalPropertyId: "prop-1",
    nationality: "SA",
    occupancy: [{ adults: 2, childAges: [] }],
    pricingContext: CONTEXT,
    ...overrides,
  };
}

function minutes(n: number): number {
  return n * 60_000;
}

describe("issueOffer + verifyOfferToken", () => {
  it("round-trips: an issued token verifies to the stored offer", async () => {
    const { service, clock } = harness();
    const expiresAt = new Date(clock.now + minutes(10));
    const issued = await service.issueOffer(TENANT, input(expiresAt));

    const verified = await service.verifyOfferToken(TENANT, issued.offerToken, {
      subTenantId: AGENCY,
    });
    expect(verified.id).toBe(issued.offerId);
    expect(verified.sell).toEqual(money(50_000, "SAR"));
    expect(verified.net).toEqual(money(50_000, "SAR"));
    expect(verified.supplierOfferToken).toBe("opaque-supplier-token-1");
    expect(verified.nationality).toBe("SA");
    expect(verified.expiresAt).toEqual(expiresAt);
    expect(verified.checkedAt).toBeNull();
  });

  it("refuses issuing beyond the short-lived TTL cap, or already expired", async () => {
    const { service, clock } = harness();
    await expect(
      service.issueOffer(TENANT, input(new Date(clock.now + (MAX_OFFER_TTL_SECONDS + 60) * 1_000))),
    ).rejects.toThrow(/TTL exceeds/);
    await expect(service.issueOffer(TENANT, input(new Date(clock.now)))).rejects.toThrow(
      /future/,
    );
  });

  it("expiryFor clamps any configured TTL into the short-lived bounds", async () => {
    const store = new InMemoryOfferStore();
    const clock = { now: T0 };
    const longService = new OffersService(store, new FixedOfferTtlSource(86_400), KEY, {
      now: () => new Date(clock.now),
    });
    expect((await longService.expiryFor(TENANT)).getTime()).toBe(
      T0 + MAX_OFFER_TTL_SECONDS * 1_000,
    );
    const shortService = new OffersService(store, new FixedOfferTtlSource(1), KEY, {
      now: () => new Date(clock.now),
    });
    expect((await shortService.expiryFor(TENANT)).getTime()).toBe(
      T0 + MIN_OFFER_TTL_SECONDS * 1_000,
    );
  });

  it("is tenant-scoped: the same token is unknown to another tenant", async () => {
    const { service, clock } = harness();
    const issued = await service.issueOffer(TENANT, input(new Date(clock.now + minutes(10))));
    await expect(service.verifyOfferToken(OTHER_TENANT, issued.offerToken)).rejects.toThrow(
      OfferError,
    );
    await expect(service.verifyOfferToken(OTHER_TENANT, issued.offerToken)).rejects.toMatchObject({
      kind: "offer_not_found",
    });
  });

  it("rejects a token whose signature half was altered", async () => {
    const { service, clock } = harness();
    const issued = await service.issueOffer(TENANT, input(new Date(clock.now + minutes(10))));
    const [prefix, id, signature] = issued.offerToken.split(".") as [string, string, string];
    const flipped = signature.startsWith("A") ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    await expect(
      service.verifyOfferToken(TENANT, `${prefix}.${id}.${flipped}`),
    ).rejects.toMatchObject({ kind: "offer_not_found" });
  });

  it.each([
    ["sell amount", { sell: money(1, "SAR") }],
    ["net amount", { net: money(1, "SAR") }],
    ["supplier token", { supplierOfferToken: "another-token" }],
    ["expiry extension", { expiresAt: new Date(T0 + minutes(120)) }],
  ] as const)("rejects an at-rest tampered row: %s", async (_label, patch) => {
    const { service, store, clock } = harness();
    const issued = await service.issueOffer(TENANT, input(new Date(clock.now + minutes(10))));
    store.tamper(TENANT, issued.offerId, patch);
    await expect(service.verifyOfferToken(TENANT, issued.offerToken)).rejects.toMatchObject({
      kind: "offer_not_found",
    });
  });

  it("enforces the signed expiry against the server clock (boundary exact)", async () => {
    const { service, clock } = harness();
    const expiresAt = new Date(clock.now + minutes(10));
    const issued = await service.issueOffer(TENANT, input(expiresAt));

    clock.now = expiresAt.getTime() - 1;
    await expect(service.verifyOfferToken(TENANT, issued.offerToken)).resolves.toBeDefined();

    clock.now = expiresAt.getTime();
    await expect(service.verifyOfferToken(TENANT, issued.offerToken)).rejects.toMatchObject({
      kind: "offer_expired",
    });
  });

  it("refuses an offer priced for another sub-tenant scope, opaquely", async () => {
    const { service, clock } = harness();
    const issued = await service.issueOffer(TENANT, input(new Date(clock.now + minutes(10))));
    await expect(
      service.verifyOfferToken(TENANT, issued.offerToken, { subTenantId: subTenantId("agency-two") }),
    ).rejects.toMatchObject({ kind: "offer_not_found" });
    await expect(
      service.verifyOfferToken(TENANT, issued.offerToken, { subTenantId: null }),
    ).rejects.toMatchObject({ kind: "offer_not_found" });
  });

  it("refuses an invalidated offer", async () => {
    const { service, clock } = harness();
    const issued = await service.issueOffer(TENANT, input(new Date(clock.now + minutes(10))));
    await service.invalidateOffer(TENANT, issued.offerId);
    await expect(service.verifyOfferToken(TENANT, issued.offerToken)).rejects.toMatchObject({
      kind: "offer_invalidated",
    });
  });

  it("validates issue inputs structurally", async () => {
    const { service, clock } = harness();
    const expiresAt = new Date(clock.now + minutes(10));
    await expect(
      service.issueOffer(TENANT, input(expiresAt, { nationality: "saudi" })),
    ).rejects.toThrow(/alpha-2/);
    await expect(
      service.issueOffer(TENANT, input(expiresAt, { supplierOfferToken: "" })),
    ).rejects.toThrow(/non-empty/);
    await expect(service.issueOffer(TENANT, input(expiresAt, { occupancy: [] }))).rejects.toThrow(
      /rooms/,
    );
    await expect(
      service.issueOffer(TENANT, input(expiresAt, { occupancy: [{ adults: 0, childAges: [] }] })),
    ).rejects.toThrow(/adult/);
  });
});

describe("requireBookableOffer (the booking gate for workstream E)", () => {
  it("refuses an unchecked offer", async () => {
    const { service, clock } = harness();
    const issued = await service.issueOffer(TENANT, input(new Date(clock.now + minutes(10))));
    await expect(service.requireBookableOffer(TENANT, issued.offerToken)).rejects.toMatchObject({
      kind: "offer_not_checked",
    });
  });

  it("admits a recently checked offer and refuses a stale check", async () => {
    const { service, clock } = harness({ bookableWindowSeconds: 300 });
    const issued = await service.issueOffer(TENANT, input(new Date(clock.now + minutes(20))));
    await service.markChecked(TENANT, issued.offerId);

    clock.now = T0 + minutes(5); // exactly the window boundary — still bookable
    await expect(service.requireBookableOffer(TENANT, issued.offerToken)).resolves.toBeDefined();

    clock.now = T0 + minutes(5) + 1;
    await expect(service.requireBookableOffer(TENANT, issued.offerToken)).rejects.toMatchObject({
      kind: "offer_not_checked",
    });
  });

  it("never admits an expired offer, checked or not", async () => {
    const { service, clock } = harness();
    const issued = await service.issueOffer(TENANT, input(new Date(clock.now + minutes(5))));
    await service.markChecked(TENANT, issued.offerId);
    clock.now = T0 + minutes(6);
    await expect(service.requireBookableOffer(TENANT, issued.offerToken)).rejects.toMatchObject({
      kind: "offer_expired",
    });
  });
});
