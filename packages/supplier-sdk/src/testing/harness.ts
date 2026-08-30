/**
 * Hotel adapter contract-test harness (docs/05-suppliers.md, docs/09-testing.md).
 *
 * The generic suite every hotel adapter must pass: the full lifecycle happy
 * path plus one scenario per SupplierErrorKind. It runs against
 * sandbox-replay recordings in CI and against the live sandbox before
 * certification — the switch is transport injection inside `makeAdapter`,
 * never a different suite.
 *
 * M0 ships the contract and assertion shapes only. There are NO supplier
 * payloads here and never will be: every scenario input (queries, guests,
 * tokens) arrives via `options` from the adapter package, drawn from real
 * recorded sandbox traffic (CLAUDE.md rule 5). With no adapter registered
 * the suite reports itself skipped; missing scenarios surface as
 * "record this scenario first" todos — mirroring sandbox-replay's cache-miss
 * failure mode.
 */

import { describe, expect, it } from "vitest";
import {
  assertValidCancellationPolicy,
  assertValidMoney,
  isSupplierError,
  SUPPLIER_ERROR_KINDS,
  type SupplierErrorKind,
} from "@jenova/domain";
import {
  BOARD_BASES,
  SUPPLIER_BOOKING_STATUSES,
  type AdapterCallContext,
  type HotelBookRequest,
  type HotelBookingRecord,
  type HotelOffer,
  type HotelSearchQuery,
  type HotelSupplierAdapter,
} from "../contracts";

// ---------------------------------------------------------------------------
// Assertion helpers — exported so adapter-specific tests reuse the same bar
// ---------------------------------------------------------------------------

export function assertHotelOffer(offer: HotelOffer, ctx?: AdapterCallContext): void {
  expect(offer.supplierOfferToken.length, "supplierOfferToken must be non-empty").toBeGreaterThan(0);
  expect(
    offer.canonicalPropertyId.length,
    "canonicalPropertyId must be non-empty",
  ).toBeGreaterThan(0);
  expect(BOARD_BASES).toContain(offer.boardBasis);
  assertValidMoney(offer.net);
  assertValidCancellationPolicy(offer.cancellationPolicy);
  expect(
    offer.nationalityApplied.length,
    "nationalityApplied must be non-empty",
  ).toBeGreaterThan(0);
  if (ctx !== undefined) {
    expect(
      offer.nationalityApplied,
      "the supplier must price for the requested nationality",
    ).toBe(ctx.nationality);
  }
}

export function assertHotelBookingRecord(record: HotelBookingRecord): void {
  expect(
    record.supplierBookingReference.length,
    "supplierBookingReference must be non-empty",
  ).toBeGreaterThan(0);
  expect(record.clientReference.length, "clientReference must be non-empty").toBeGreaterThan(0);
  expect(SUPPLIER_BOOKING_STATUSES).toContain(record.status);
  assertValidMoney(record.net);
  assertValidCancellationPolicy(record.cancellationPolicy);
}

/** Awaits `run` and asserts it rejects with a SupplierError of exactly `kind`. */
export async function expectSupplierErrorKind(
  run: () => Promise<unknown>,
  kind: SupplierErrorKind,
): Promise<void> {
  let outcome: unknown;
  let rejected = false;
  try {
    await run();
  } catch (error) {
    rejected = true;
    outcome = error;
  }
  expect(rejected, `expected SupplierError(${kind}) but the call succeeded`).toBe(true);
  expect(
    isSupplierError(outcome),
    `expected SupplierError(${kind}), got ${String(outcome)}`,
  ).toBe(true);
  if (isSupplierError(outcome)) {
    expect(outcome.kind).toBe(kind);
  }
}

// ---------------------------------------------------------------------------
// Suite factory
// ---------------------------------------------------------------------------

/**
 * Lifecycle inputs, drawn from recorded sandbox traffic by the adapter
 * package (never invented): the query that produced recorded offers, and a
 * builder turning the checked offer into the recorded book request.
 */
export interface HotelHappyPathScenario {
  readonly query: HotelSearchQuery;
  readonly makeBookRequest: (checkedOffer: HotelOffer) => HotelBookRequest;
}

/** Drives the adapter into one recorded failure and returns its rejecting call. */
export interface HotelErrorScenario {
  readonly run: (adapter: HotelSupplierAdapter, ctx: AdapterCallContext) => Promise<unknown>;
}

export interface HotelAdapterContractOptions {
  readonly supplierCode: string;
  /** Fresh per-test context (deadline in the future, recorded credentials env). */
  readonly makeContext?: () => AdapterCallContext;
  readonly happyPath?: HotelHappyPathScenario;
  /** One recorded scenario per SupplierErrorKind; missing kinds become todos. */
  readonly errorScenarios?: Partial<Record<SupplierErrorKind, HotelErrorScenario>>;
}

/**
 * Vitest-compatible contract suite factory. `makeAdapter` returns the
 * adapter under test wired to either a replay transport (CI) or the live
 * sandbox transport (pre-certification) — or null/undefined when no adapter
 * is registered yet, which registers the suite as skipped.
 */
export function describeHotelAdapterContract(
  makeAdapter: () => HotelSupplierAdapter | null | undefined,
  options: HotelAdapterContractOptions,
): void {
  const adapter = makeAdapter();

  describe(`hotel adapter contract: ${options.supplierCode}`, () => {
    if (adapter == null) {
      it.skip("skipped: no adapter registered — the first hotel adapter and its recordings land in M1", () => {
        /* intentionally empty: contract execution requires a real adapter */
      });
      return;
    }

    const { makeContext, happyPath } = options;

    describe("lifecycle happy path (search → check → book → retrieve → cancel)", () => {
      if (makeContext === undefined || happyPath === undefined) {
        it.todo("record this scenario first: lifecycle happy path (sandbox-replay)");
        return;
      }

      let checkedOffer: HotelOffer | undefined;
      let bookRequest: HotelBookRequest | undefined;
      let booked: HotelBookingRecord | undefined;

      it("search returns canonical offers priced for the requested nationality", async () => {
        const ctx = makeContext();
        const offers = await adapter.search(ctx, happyPath.query);
        expect(offers.length).toBeGreaterThan(0);
        for (const offer of offers) {
          assertHotelOffer(offer, ctx);
        }
      });

      it("check revalidates an offer into a bookable rate", async () => {
        const ctx = makeContext();
        const offers = await adapter.search(ctx, happyPath.query);
        const first = offers[0];
        expect(first).toBeDefined();
        if (first === undefined) {
          return;
        }
        checkedOffer = await adapter.check(ctx, first.supplierOfferToken);
        assertHotelOffer(checkedOffer, ctx);
      });

      it("book confirms and passes the clientReference through", async () => {
        expect(checkedOffer).toBeDefined();
        if (checkedOffer === undefined) {
          return;
        }
        const ctx = makeContext();
        bookRequest = happyPath.makeBookRequest(checkedOffer);
        booked = await adapter.book(ctx, bookRequest);
        assertHotelBookingRecord(booked);
        expect(booked.clientReference).toBe(bookRequest.clientReference);
        expect(booked.status === "confirmed" || booked.status === "pending").toBe(true);
      });

      it("retrieve returns the booked record by supplier reference", async () => {
        expect(booked).toBeDefined();
        if (booked === undefined) {
          return;
        }
        const ctx = makeContext();
        const retrieved = await adapter.retrieve(ctx, booked.supplierBookingReference);
        assertHotelBookingRecord(retrieved);
        expect(retrieved.supplierBookingReference).toBe(booked.supplierBookingReference);
        expect(retrieved.clientReference).toBe(booked.clientReference);
      });

      it("cancel transitions the booking to cancelled", async () => {
        expect(booked).toBeDefined();
        if (booked === undefined) {
          return;
        }
        const ctx = makeContext();
        const cancelled = await adapter.cancel(ctx, booked.supplierBookingReference);
        assertHotelBookingRecord(cancelled);
        expect(cancelled.status).toBe("cancelled");
      });
    });

    describe("error taxonomy: every kind maps from real supplier failures", () => {
      for (const kind of SUPPLIER_ERROR_KINDS) {
        const scenario = options.errorScenarios?.[kind];
        if (scenario === undefined || makeContext === undefined) {
          it.todo(`record this scenario first: ${kind}`);
          continue;
        }
        it(`rejects with SupplierError(${kind})`, async () => {
          await expectSupplierErrorKind(() => scenario.run(adapter, makeContext()), kind);
        });
      }
    });
  });
}
