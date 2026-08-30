/**
 * Fan-out orchestrator unit tests (issue #59).
 *
 * SUPPLIER INTERACTION (CLAUDE.md rule 5): these tests drive the search
 * through the registry seam with structural HotelSupplierAdapter doubles
 * that return ONLY the abstract canonical values the tests construct — no
 * supplier-shaped payloads, no fabricated supplier responses. They prove
 * the ENGINE mechanism (parallel lanes, hard budget, partial results,
 * per-supplier taxonomy isolation, pricing + signed-offer issuance); the
 * real supplier path is proven by the replay-backed SSE integration test
 * and the recorded live run.
 */

import { money, SupplierError, tenantId, type CancellationPolicy, type TenantId } from "@jenova/domain";
import type { AdapterCallContext, HotelOffer, HotelSearchQuery, HotelSupplierAdapter } from "@jenova/supplier-sdk";
import { describe, expect, it } from "vitest";
import { InMemoryOfferStore } from "../offers/offer-store";
import { FixedOfferTtlSource, OffersService } from "../offers/offers.service";
import { InMemoryMarkupRuleSource, PricingService } from "../pricing/pricing.service";
import { StaticSupplierRegistry, type SupplierCredentialsSource } from "../supplier-registry";
import { HotelSearchService, type HotelSearchEvent, type HotelSearchRequest } from "./search.service";
import { InMemorySupplierAccountsSource } from "./supplier-accounts";

const KEY = "unit-test-signing-key-0123456789abcdef";
const TENANT: TenantId = tenantId("tenant-search");

const POLICY: CancellationPolicy = {
  refundable: true,
  rules: [{ fromUtc: "2026-10-01T00:00:00.000Z", penalty: money(10_000, "SAR") }],
};

const QUERY: HotelSearchQuery = {
  target: { kind: "properties", canonicalPropertyIds: ["prop-1", "prop-2"] },
  checkIn: "2026-10-13",
  checkOut: "2026-10-15",
  rooms: [{ adults: 2, childAges: [6] }],
};

function makeRequest(overrides: Partial<HotelSearchRequest> = {}): HotelSearchRequest {
  return {
    query: QUERY,
    nationality: "SA",
    currency: "SAR",
    locale: "en",
    subTenantId: null,
    channel: "b2b",
    ...overrides,
  };
}

/** A structural canonical offer for one lane — values the test itself picks. */
function laneOffer(net: number, propertyId = "prop-1", nationality = "SA"): HotelOffer {
  return {
    supplierOfferToken: `opaque-${propertyId}-${net}`,
    canonicalPropertyId: propertyId,
    supplierRoomName: "room-1",
    boardBasis: "RO",
    net: money(net, "SAR"),
    cancellationPolicy: POLICY,
    nationalityApplied: nationality,
  };
}

/** Configurable per-lane double: resolve after a delay, or refuse. */
class SearchAdapterDouble implements HotelSupplierAdapter {
  readonly vertical = "hotel";
  searchCalls = 0;
  lastContext: AdapterCallContext | null = null;

  constructor(
    readonly supplierCode: string,
    private readonly behavior: (ctx: AdapterCallContext) => Promise<readonly HotelOffer[]>,
  ) {}

  search(ctx: AdapterCallContext): Promise<readonly HotelOffer[]> {
    this.searchCalls += 1;
    this.lastContext = ctx;
    return this.behavior(ctx);
  }

  check(): Promise<never> {
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

function resolveAfter(ms: number, offers: readonly HotelOffer[]) {
  return (): Promise<readonly HotelOffer[]> =>
    new Promise((resolve) => setTimeout(() => resolve(offers), ms));
}

/** Structural credentials — mechanism plumbing, no secret material. */
const credentials: SupplierCredentialsSource = {
  credentialsFor: (tenant, supplierCode) =>
    Promise.resolve({ tenantId: tenant, supplierCode, environment: "sandbox", secrets: {} }),
};

interface Harness {
  readonly service: HotelSearchService;
  readonly offersService: OffersService;
  readonly rules: InMemoryMarkupRuleSource;
  collect(request?: HotelSearchRequest): Promise<HotelSearchEvent[]>;
}

function harness(
  adapters: readonly HotelSupplierAdapter[],
  options: { budgetMs?: number; enabled?: readonly string[] } = {},
): Harness {
  const registry = new StaticSupplierRegistry(adapters);
  const accounts = new InMemorySupplierAccountsSource();
  accounts.setEnabled(TENANT, options.enabled ?? adapters.map((a) => a.supplierCode));
  const offersService = new OffersService(new InMemoryOfferStore(), new FixedOfferTtlSource(), KEY);
  const rules = new InMemoryMarkupRuleSource();
  const service = new HotelSearchService(
    registry,
    accounts,
    credentials,
    new PricingService(rules),
    offersService,
    { budgetMs: options.budgetMs ?? 2_000 },
  );
  return {
    service,
    offersService,
    rules,
    collect: async (request = makeRequest()) => {
      const events: HotelSearchEvent[] = [];
      for await (const event of service.search(TENANT, request)) {
        events.push(event);
      }
      return events;
    },
  };
}

function eventsOfType<T extends HotelSearchEvent["type"]>(
  events: readonly HotelSearchEvent[],
  type: T,
): Extract<HotelSearchEvent, { type: T }>[] {
  return events.filter((event): event is Extract<HotelSearchEvent, { type: T }> => event.type === type);
}

describe("fan-out across N suppliers (registry seam)", () => {
  it("queries every enabled+registered supplier in parallel and reports each once", async () => {
    const a = new SearchAdapterDouble("sup-a", resolveAfter(5, [laneOffer(50_000)]));
    const b = new SearchAdapterDouble("sup-b", resolveAfter(5, [laneOffer(60_000, "prop-2"), laneOffer(70_000, "prop-2")]));
    const c = new SearchAdapterDouble("sup-c", resolveAfter(5, []));
    const h = harness([a, b, c]);

    const events = await h.collect();
    const started = eventsOfType(events, "search.started");
    expect(started).toHaveLength(1);
    expect([...(started[0]?.supplierCodes ?? [])].sort()).toEqual(["sup-a", "sup-b", "sup-c"]);

    const results = eventsOfType(events, "supplier.results");
    expect(results.map((e) => e.supplierCode).sort()).toEqual(["sup-a", "sup-b", "sup-c"]);
    expect(results.find((e) => e.supplierCode === "sup-b")?.offers).toHaveLength(2);

    const completed = eventsOfType(events, "search.completed");
    expect(completed).toEqual([
      {
        type: "search.completed",
        searchId: started[0]?.searchId,
        status: "complete",
        suppliersQueried: 3,
        suppliersSucceeded: 3,
        suppliersFailed: 0,
        offerCount: 3,
      },
    ]);
    expect(a.searchCalls + b.searchCalls + c.searchCalls).toBe(3);
  });

  it("skips enabled suppliers with no registered hotel adapter", async () => {
    const a = new SearchAdapterDouble("sup-a", resolveAfter(1, [laneOffer(50_000)]));
    const h = harness([a], { enabled: ["sup-a", "sup-never-deployed"] });
    const events = await h.collect();
    expect(eventsOfType(events, "search.started")[0]?.supplierCodes).toEqual(["sup-a"]);
    expect(eventsOfType(events, "search.completed")[0]?.suppliersQueried).toBe(1);
  });

  it("completes immediately when the tenant has no enabled suppliers", async () => {
    const h = harness([], { enabled: [] });
    const events = await h.collect();
    expect(events.map((e) => e.type)).toEqual(["search.started", "search.completed"]);
    expect(eventsOfType(events, "search.completed")[0]?.status).toBe("complete");
  });
});

describe("hard budget + partial results", () => {
  it("a slow supplier never blocks the others — its lane times out, theirs deliver", async () => {
    const fast = new SearchAdapterDouble("sup-fast", resolveAfter(5, [laneOffer(50_000)]));
    // Resolves far beyond the budget; the orchestrator must not wait for it.
    const slow = new SearchAdapterDouble("sup-slow", resolveAfter(60_000, [laneOffer(99_000)]));
    const h = harness([fast, slow], { budgetMs: 500 });

    const startedAt = Date.now();
    const events = await h.collect();
    expect(Date.now() - startedAt).toBeLessThan(5_000);

    const results = eventsOfType(events, "supplier.results");
    expect(results.map((e) => e.supplierCode)).toEqual(["sup-fast"]);
    expect(results[0]?.offers).toHaveLength(1);

    const failures = eventsOfType(events, "supplier.failed");
    expect(failures).toEqual([
      expect.objectContaining({ supplierCode: "sup-slow", kind: "supplier_timeout" }),
    ]);

    const completed = eventsOfType(events, "search.completed")[0];
    expect(completed?.status).toBe("budget_exhausted");
    expect(completed?.suppliersSucceeded).toBe(1);
    expect(completed?.suppliersFailed).toBe(1);
    expect(completed?.offerCount).toBe(1);
  });

  it("hands adapters a deadline inside the budget window (AdapterCallContext)", async () => {
    const a = new SearchAdapterDouble("sup-a", resolveAfter(1, []));
    const h = harness([a], { budgetMs: 1_000 });
    const before = Date.now();
    await h.collect();
    const deadline = a.lastContext?.deadline.getTime() ?? 0;
    expect(deadline).toBeGreaterThan(before);
    expect(deadline).toBeLessThanOrEqual(before + 1_500);
  });
});

describe("per-supplier failure isolation (unified taxonomy)", () => {
  it("maps a lane's SupplierError kind into supplier.failed without failing the search", async () => {
    const ok = new SearchAdapterDouble("sup-ok", resolveAfter(5, [laneOffer(50_000)]));
    const down = new SearchAdapterDouble("sup-down", () =>
      Promise.reject(new SupplierError("auth_failed", "credentials refused")),
    );
    const limited = new SearchAdapterDouble("sup-limited", () =>
      Promise.reject(new SupplierError("rate_limited", "slow down")),
    );
    const h = harness([ok, down, limited]);

    const events = await h.collect();
    const failures = eventsOfType(events, "supplier.failed");
    expect(
      failures.map((e) => [e.supplierCode, e.kind]).sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    ).toEqual([
      ["sup-down", "auth_failed"],
      ["sup-limited", "rate_limited"],
    ]);
    const completed = eventsOfType(events, "search.completed")[0];
    expect(completed?.status).toBe("complete");
    expect(completed?.suppliersSucceeded).toBe(1);
    expect(completed?.suppliersFailed).toBe(2);
  });

  it("an engine-side lane failure surfaces as supplier_unavailable, isolated", async () => {
    const ok = new SearchAdapterDouble("sup-ok", resolveAfter(5, [laneOffer(50_000)]));
    const broken = new SearchAdapterDouble("sup-broken", () =>
      Promise.reject(new Error("adapter blew up")),
    );
    const h = harness([ok, broken]);
    const events = await h.collect();
    expect(eventsOfType(events, "supplier.failed")).toEqual([
      expect.objectContaining({ supplierCode: "sup-broken", kind: "supplier_unavailable" }),
    ]);
    expect(eventsOfType(events, "supplier.results")).toHaveLength(1);
  });

  it("refuses a lane whose adapter echoes the wrong nationality — wrong-rate offers never reach a client", async () => {
    const drifting = new SearchAdapterDouble("sup-drift", () =>
      Promise.resolve([laneOffer(50_000, "prop-1", "EG")]),
    );
    const h = harness([drifting]);
    const events = await h.collect();
    expect(eventsOfType(events, "supplier.results")).toHaveLength(0);
    expect(eventsOfType(events, "supplier.failed")[0]?.kind).toBe("supplier_unavailable");
  });
});

describe("pricing + signed-offer issuance (rules 6/8)", () => {
  it("prices through the markup engine and issues verifiable signed offers", async () => {
    const a = new SearchAdapterDouble("sup-a", resolveAfter(1, [laneOffer(50_000)]));
    const h = harness([a]);
    h.rules.setRules(TENANT, [
      {
        id: "rule-10pct",
        priority: 0,
        agencyId: null,
        channel: null,
        vertical: "hotel",
        supplierCode: null,
        destination: null,
        travelFrom: null,
        travelTo: null,
        valueType: "percent",
        value: 1_000n, // +10%
        currency: null,
        commissionSplitBps: null,
        active: true,
      },
    ]);

    const events = await h.collect();
    const summary = eventsOfType(events, "supplier.results")[0]?.offers[0];
    expect(summary).toBeDefined();
    if (summary === undefined) throw new Error("no summary");
    // 50_000 net + 10% markup = 55_000 sell (VAT-inclusive default).
    expect(summary.sell).toEqual(money(55_000, "SAR"));
    expect(summary.offerToken.startsWith("of1.")).toBe(true);
    expect(summary.refundable).toBe(true);

    // The token verifies end to end and pins nationality + pricing scope.
    const verified = await h.offersService.verifyOfferToken(TENANT, summary.offerToken, {
      subTenantId: null,
    });
    expect(verified.nationality).toBe("SA");
    expect(verified.sell).toEqual(money(55_000, "SAR"));
    expect(verified.markupRuleId).toBe("rule-10pct");
    expect(verified.pricingContext.channel).toBe("b2b");
    expect(verified.pricingContext.nights).toBe(2);
    expect(verified.pricingContext.paxCount).toBe(3);
    expect(verified.occupancy).toEqual(QUERY.rooms);
  });

  it("refuses a structurally invalid request before touching any supplier", async () => {
    const a = new SearchAdapterDouble("sup-a", resolveAfter(1, []));
    const h = harness([a]);
    await expect(
      h.collect(makeRequest({ nationality: "saudi" })),
    ).rejects.toThrow(/nationality/);
    await expect(
      h.collect(makeRequest({ query: { ...QUERY, checkOut: "2026-10-13" } })),
    ).rejects.toThrow(/checkOut/);
    expect(a.searchCalls).toBe(0);
  });
});
