/**
 * Check revalidation unit tests (issue #65).
 *
 * SUPPLIER INTERACTION: the first hotel adapter has not merged, so these
 * tests drive checkOffer through the HotelSupplierAdapter interface with a
 * minimal in-repo test double that contains NO supplier-shaped data — it
 * only echoes back (or structurally perturbs, or refuses via the unified
 * SupplierError taxonomy) the abstract canonical values the test itself
 * put into the offer under test. This proves the ENGINE mechanism
 * (signature gate → supplier call → compare → supersede/invalidate), which
 * CLAUDE.md rule 5 permits; it fabricates no supplier response. The full
 * live path is proven in the workstream E integration once the adapter
 * merges.
 */

import { money, SupplierError, tenantId, type CancellationPolicy, type TenantId } from "@jenova/domain";
import type { AdapterCallContext, HotelOffer, HotelSupplierAdapter } from "@jenova/supplier-sdk";
import { describe, expect, it } from "vitest";
import { assemblePricedOffer } from "../pricing/offer";
import { InMemoryMarkupRuleSource, PricingService } from "../pricing/pricing.service";
import { resolvePrice } from "../pricing/resolve";
import type { PricingContext } from "../pricing/rules";
import { StaticSupplierRegistry, type SupplierCredentialsSource } from "@jenova/supplier-registry";
import { OfferCheckService } from "./check.service";
import { SupplierUnavailableError } from "./errors";
import { InMemoryOfferStore } from "./offer-store";
import { FixedOfferTtlSource, OffersService } from "./offers.service";

const KEY = "unit-test-signing-key-0123456789abcdef";
const TENANT: TenantId = tenantId("tenant-check");
const T0 = Date.parse("2026-08-30T10:00:00.000Z");

const POLICY: CancellationPolicy = {
  refundable: true,
  rules: [{ fromUtc: "2026-09-10T00:00:00.000Z", penalty: money(50_000, "SAR") }],
};

const CONTEXT: PricingContext = {
  subTenantId: null,
  channel: "b2b",
  vertical: "hotel",
  supplierCode: "sup-a",
  destination: null,
  travelDate: null,
  nights: 2,
  paxCount: 2,
};

/** Echo/perturb/refuse double — structural values only (see file header). */
class HotelAdapterDouble implements HotelSupplierAdapter {
  readonly supplierCode = "sup-a";
  readonly vertical = "hotel";
  checkCalls = 0;
  onCheck: (ctx: AdapterCallContext, supplierOfferToken: string) => HotelOffer = () => {
    throw new Error("onCheck not configured");
  };

  check(ctx: AdapterCallContext, supplierOfferToken: string): Promise<HotelOffer> {
    this.checkCalls += 1;
    try {
      return Promise.resolve(this.onCheck(ctx, supplierOfferToken));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  search(): Promise<readonly HotelOffer[]> {
    return Promise.reject(new Error("not under test"));
  }
  book(): Promise<never> {
    return Promise.reject(new Error("not under test"));
  }
  retrieve(): Promise<never> {
    return Promise.reject(new Error("not under test"));
  }
  cancel(): Promise<never> {
    return Promise.reject(new Error("not under test"));
  }
}

/** Structural credentials — mechanism plumbing, no secret material. */
const credentials: SupplierCredentialsSource = {
  credentialsFor: (tenant, supplierCode) =>
    Promise.resolve({ tenantId: tenant, supplierCode, environment: "sandbox", secrets: {} }),
};

interface Harness {
  readonly service: OfferCheckService;
  readonly offersService: OffersService;
  readonly store: InMemoryOfferStore;
  readonly adapter: HotelAdapterDouble;
  readonly clock: { now: number };
  issue(): Promise<{ offerId: string; offerToken: string }>;
  /** The canonical echo: exactly what the stored offer promises. */
  echo(overrides?: Partial<HotelOffer>): HotelOffer;
}

function harness(options: { registerAdapter?: boolean } = {}): Harness {
  const clock = { now: T0 };
  const now = (): Date => new Date(clock.now);
  const store = new InMemoryOfferStore();
  const offersService = new OffersService(store, new FixedOfferTtlSource(), KEY, { now });
  const adapter = new HotelAdapterDouble();
  const registry = new StaticSupplierRegistry(options.registerAdapter === false ? [] : [adapter]);
  const pricing = new PricingService(new InMemoryMarkupRuleSource());
  const service = new OfferCheckService(offersService, pricing, registry, credentials, { now });

  return {
    service,
    offersService,
    store,
    adapter,
    clock,
    issue: async () => {
      const resolution = resolvePrice(money(50_000, "SAR"), CONTEXT, []);
      const priced = assemblePricedOffer(
        {
          supplierCode: "sup-a",
          vertical: "hotel",
          policySnapshot: POLICY,
          expiresAt: new Date(clock.now + 10 * 60_000),
        },
        resolution,
      );
      return offersService.issueOffer(TENANT, {
        offer: priced,
        supplierOfferToken: "opaque-token-1",
        canonicalPropertyId: "prop-1",
        nationality: "SA",
        occupancy: [{ adults: 2, childAges: [] }],
        pricingContext: CONTEXT,
      });
    },
    echo: (overrides = {}) => ({
      supplierOfferToken: "opaque-token-1",
      canonicalPropertyId: "prop-1",
      supplierRoomName: "room-1",
      boardBasis: "RO",
      net: money(50_000, "SAR"),
      cancellationPolicy: POLICY,
      nationalityApplied: "SA",
      ...overrides,
    }),
  };
}

describe("checkOffer — unchanged", () => {
  it("marks the offer checked and opens the bookable window", async () => {
    const h = harness();
    const issued = await h.issue();
    h.adapter.onCheck = () => h.echo();

    const result = await h.service.checkOffer(TENANT, issued.offerToken);
    expect(result.status).toBe("unchanged");
    if (result.status !== "unchanged") throw new Error("unreachable");
    expect(result.offerId).toBe(issued.offerId);
    expect(result.offerToken).toBe(issued.offerToken);
    expect(result.sell).toEqual(money(50_000, "SAR"));

    // The gate workstream E calls now admits it.
    const bookable = await h.offersService.requireBookableOffer(TENANT, issued.offerToken);
    expect(bookable.checkedAt).toEqual(new Date(h.clock.now));
    expect(h.adapter.checkCalls).toBe(1);
  });

  it("supersedes transparently when only the supplier's token rotated", async () => {
    const h = harness();
    const issued = await h.issue();
    h.adapter.onCheck = () => h.echo({ supplierOfferToken: "opaque-token-2" });

    const result = await h.service.checkOffer(TENANT, issued.offerToken);
    expect(result.status).toBe("unchanged");
    if (result.status !== "unchanged") throw new Error("unreachable");
    expect(result.offerToken).not.toBe(issued.offerToken);
    expect(result.sell).toEqual(money(50_000, "SAR"));

    // Old offer is gone; the successor is bookable and wraps the new token.
    await expect(h.offersService.verifyOfferToken(TENANT, issued.offerToken)).rejects.toMatchObject({
      kind: "offer_invalidated",
    });
    const successor = await h.offersService.requireBookableOffer(TENANT, result.offerToken);
    expect(successor.supplierOfferToken).toBe("opaque-token-2");
  });
});

describe("checkOffer — price changed", () => {
  it("persists the new supplier state as a NEW signed offer and returns the delta", async () => {
    const h = harness();
    const issued = await h.issue();
    h.adapter.onCheck = () => h.echo({ net: money(55_000, "SAR") });

    const result = await h.service.checkOffer(TENANT, issued.offerToken);
    expect(result.status).toBe("price_changed");
    if (result.status !== "price_changed") throw new Error("unreachable");
    expect(result.oldSell).toEqual(money(50_000, "SAR"));
    expect(result.newSell).toEqual(money(55_000, "SAR")); // no markup rules bound
    expect(result.policyChanged).toBe(false);

    // Old offer invalidated; successor verifies, carries the new net, and is
    // born checked so the approving client books without another round-trip.
    await expect(h.offersService.verifyOfferToken(TENANT, issued.offerToken)).rejects.toMatchObject({
      kind: "offer_invalidated",
    });
    const successor = await h.offersService.requireBookableOffer(TENANT, result.newOfferToken);
    expect(successor.net).toEqual(money(55_000, "SAR"));
    expect(successor.id).toBe(result.newOfferId);
  });

  it("the LOSING racer of a concurrent supersede mints no second successor (review MEDIUM-1)", async () => {
    const h = harness();
    const issued = await h.issue();
    // Simulate the race: while THIS check is out at the supplier, a rival
    // check (or sold_out) claims the offer. The store's conditional claim
    // then refuses this caller's supersede.
    h.adapter.onCheck = () => {
      h.store.tamper(TENANT, issued.offerId, { invalidatedAt: new Date(h.clock.now) });
      return h.echo({ net: money(55_000, "SAR") });
    };

    await expect(h.service.checkOffer(TENANT, issued.offerToken)).rejects.toMatchObject({
      kind: "offer_invalidated",
    });
  });

  it("a policy-only change also supersedes, flagged for re-approval", async () => {
    const h = harness();
    const issued = await h.issue();
    const movedPolicy: CancellationPolicy = {
      refundable: false,
      rules: [{ fromUtc: "2026-09-01T00:00:00.000Z", penalty: money(50_000, "SAR") }],
    };
    h.adapter.onCheck = () => h.echo({ cancellationPolicy: movedPolicy });

    const result = await h.service.checkOffer(TENANT, issued.offerToken);
    expect(result.status).toBe("price_changed");
    if (result.status !== "price_changed") throw new Error("unreachable");
    expect(result.policyChanged).toBe(true);
    expect(result.newSell).toEqual(result.oldSell);

    const successor = await h.offersService.requireBookableOffer(TENANT, result.newOfferToken);
    expect(successor.policySnapshot).toEqual(movedPolicy);
  });
});

describe("checkOffer — supplier failures (unified taxonomy)", () => {
  it("sold_out invalidates the offer for good", async () => {
    const h = harness();
    const issued = await h.issue();
    h.adapter.onCheck = () => {
      throw new SupplierError("sold_out", "gone");
    };

    await expect(h.service.checkOffer(TENANT, issued.offerToken)).rejects.toMatchObject({
      kind: "sold_out",
    });
    await expect(h.offersService.verifyOfferToken(TENANT, issued.offerToken)).rejects.toMatchObject({
      kind: "offer_invalidated",
    });
  });

  it("an adapter-level price_changed rejection (no fresh state) invalidates too", async () => {
    const h = harness();
    const issued = await h.issue();
    h.adapter.onCheck = () => {
      throw new SupplierError("price_changed", "rate moved");
    };

    await expect(h.service.checkOffer(TENANT, issued.offerToken)).rejects.toMatchObject({
      kind: "price_changed",
    });
    await expect(h.offersService.verifyOfferToken(TENANT, issued.offerToken)).rejects.toMatchObject({
      kind: "offer_invalidated",
    });
  });

  it("a transient failure (timeout) leaves the offer intact for a retry", async () => {
    const h = harness();
    const issued = await h.issue();
    h.adapter.onCheck = () => {
      throw new SupplierError("supplier_timeout", "deadline passed");
    };

    await expect(h.service.checkOffer(TENANT, issued.offerToken)).rejects.toMatchObject({
      kind: "supplier_timeout",
    });
    await expect(h.offersService.verifyOfferToken(TENANT, issued.offerToken)).resolves.toBeDefined();
  });

  it("no deployed adapter is supplier unavailability, not a crash", async () => {
    const h = harness({ registerAdapter: false });
    const issued = await h.issue();
    await expect(h.service.checkOffer(TENANT, issued.offerToken)).rejects.toBeInstanceOf(
      SupplierUnavailableError,
    );
  });
});

describe("checkOffer — the signature/TTL gate runs BEFORE any supplier call", () => {
  it("an expired offer never reaches the adapter", async () => {
    const h = harness();
    const issued = await h.issue();
    h.adapter.onCheck = () => h.echo();
    h.clock.now = T0 + 11 * 60_000;

    await expect(h.service.checkOffer(TENANT, issued.offerToken)).rejects.toMatchObject({
      kind: "offer_expired",
    });
    expect(h.adapter.checkCalls).toBe(0);
  });

  it("a tampered token never reaches the adapter", async () => {
    const h = harness();
    const issued = await h.issue();
    h.adapter.onCheck = () => h.echo();
    const [p, id, sig] = issued.offerToken.split(".") as [string, string, string];
    const flipped = sig.startsWith("A") ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;

    await expect(h.service.checkOffer(TENANT, `${p}.${id}.${flipped}`)).rejects.toMatchObject({
      kind: "offer_not_found",
    });
    expect(h.adapter.checkCalls).toBe(0);
  });

  it("a mis-echoing adapter is an invariant failure, and the offer survives", async () => {
    const h = harness();
    const issued = await h.issue();
    h.adapter.onCheck = () => h.echo({ nationalityApplied: "AE" });

    await expect(h.service.checkOffer(TENANT, issued.offerToken)).rejects.toThrow(/nationality/);
    await expect(h.offersService.verifyOfferToken(TENANT, issued.offerToken)).resolves.toBeDefined();
  });
});
