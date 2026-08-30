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
  // clientReference may be empty on records built from retrieval surfaces
  // that do not return it (e.g. TBO BookingDetail) — the book() echo is
  // asserted separately in the lifecycle test.
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
  /**
   * Which searched offer the lifecycle books. Defaults to the first offer;
   * real certifications pick deliberately (a cheap refundable rate whose
   * free-cancellation window is open) so the live run books something that
   * can be cancelled at no charge.
   */
  readonly pickOffer?: (offers: readonly HotelOffer[]) => HotelOffer;
  readonly makeBookRequest: (checkedOffer: HotelOffer) => HotelBookRequest;
  /**
   * Whether this supplier's retrieve surface returns the clientReference it
   * was given at book time. Adapters DECLARE this capability from recorded
   * evidence (review #74 L2) — the harness asserts the declaration both
   * ways and never infers behavior from whatever value came back.
   */
  readonly retrieveEchoesClientReference: boolean;
}

/** Drives the adapter into one recorded failure and returns its rejecting call. */
export interface HotelErrorScenario {
  readonly run: (adapter: HotelSupplierAdapter, ctx: AdapterCallContext) => Promise<unknown>;
}

/**
 * Declares a kind certified on standing evidence instead of being driven in
 * this run: committed real recordings, or a mechanism test at the transport
 * layer — cited in `evidenceBasis`, which the certification report renders
 * verbatim. The harness registers it as a skipped check titled
 * `evidence: <kind> — <basis>` so the report shows EVIDENCE, never a
 * fabricated PASS (the check did not execute in this mode).
 */
export interface HotelErrorEvidence {
  readonly evidenceBasis: string;
}

/** A kind is either driven (`run`) or declared evidence-backed for this mode. */
export type HotelErrorScenarioEntry = HotelErrorScenario | HotelErrorEvidence;

export interface HotelAdapterContractOptions {
  readonly supplierCode: string;
  /** Fresh per-test context (deadline in the future, recorded credentials env). */
  readonly makeContext?: () => AdapterCallContext;
  readonly happyPath?: HotelHappyPathScenario;
  /** One recorded scenario per SupplierErrorKind; missing kinds become todos. */
  readonly errorScenarios?: Partial<Record<SupplierErrorKind, HotelErrorScenarioEntry>>;
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
        const picked = (happyPath.pickOffer ?? ((all) => all[0]))(offers);
        expect(picked).toBeDefined();
        if (picked === undefined) {
          return;
        }
        checkedOffer = await adapter.check(ctx, picked.supplierOfferToken);
        assertHotelOffer(checkedOffer, ctx);
      });

      it("book confirms and passes the clientReference through", async () => {
        expect(checkedOffer).toBeDefined();
        if (checkedOffer === undefined) {
          return;
        }
        const ctx = makeContext();
        bookRequest = happyPath.makeBookRequest(checkedOffer);
        // Guard the echo assertion against vacuous "" === "" (review L1):
        // an empty clientReference would void the idempotency check.
        expect(
          bookRequest.clientReference.length,
          "the book scenario must supply a non-empty clientReference",
        ).toBeGreaterThan(0);
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
        // The adapter DECLARES whether retrieve echoes the clientReference
        // (review #74 L2) — the harness holds it to the declaration instead
        // of quietly accepting whichever value arrived.
        if (happyPath.retrieveEchoesClientReference) {
          expect(
            retrieved.clientReference,
            "adapter declares retrieve echoes the clientReference",
          ).toBe(booked.clientReference);
        } else {
          expect(
            retrieved.clientReference,
            "adapter declares retrieve does NOT echo the clientReference — a non-empty value contradicts the declared capability",
          ).toBe("");
        }
      });

      it("cancel transitions the booking to cancelled (or pending for async cancellation)", async () => {
        expect(booked).toBeDefined();
        if (booked === undefined) {
          return;
        }
        const ctx = makeContext();
        const cancelled = await adapter.cancel(ctx, booked.supplierBookingReference);
        assertHotelBookingRecord(cancelled);
        // Some suppliers cancel asynchronously (TBO: CancellationInProgress);
        // "pending" hands the settle-to-cancelled watch to the engine's
        // polling worker. It must never remain "confirmed".
        expect(cancelled.status === "cancelled" || cancelled.status === "pending").toBe(true);
      });
    });

    describe("error taxonomy: every kind maps from real supplier failures", () => {
      for (const kind of SUPPLIER_ERROR_KINDS) {
        const entry = options.errorScenarios?.[kind];
        if (entry === undefined || makeContext === undefined) {
          it.todo(`record this scenario first: ${kind}`);
          continue;
        }
        if (!("run" in entry)) {
          // Declared evidence: cited, not driven, in this mode. Registered
          // skipped so nothing pretends to have executed; certification
          // reporting renders it as EVIDENCE with the basis verbatim.
          it.skip(`evidence: ${kind} — ${entry.evidenceBasis}`, () => {
            /* intentionally empty: the cited evidence lives elsewhere */
          });
          continue;
        }
        it(`rejects with SupplierError(${kind})`, async () => {
          await expectSupplierErrorKind(() => entry.run(adapter, makeContext()), kind);
        });
      }
    });
  });
}
