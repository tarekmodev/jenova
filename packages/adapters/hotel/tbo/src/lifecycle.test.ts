/**
 * check / book / retrieve / cancel over the recorded live lifecycle
 * (booking LVFXI5: Riyadh studio, 139.73 USD, refundable — booked on the
 * real sandbox on 2026-08-30 and cancelled immediately). Replay resolves
 * the exact requests the adapter builds; the fingerprints break loudly if
 * the request shapes drift.
 */

import { describe, expect, it } from "vitest";
import { money } from "@jenova/domain";
import type { HotelOffer } from "@jenova/supplier-sdk";
import { assertHotelBookingRecord, assertHotelOffer } from "@jenova/supplier-sdk/testing";
import { createTboHotelAdapter } from "./adapter";
import { decodeOfferToken, encodeOfferToken } from "./mapping";
import {
  makeRecordedBookRequest,
  pickLifecycleOffer,
  RECORDED_CLIENT_REFERENCE,
  RECORDED_SEARCH_INSTANT,
  RECORDED_SEARCH_QUERY,
} from "./recorded-scenarios";
import { makeTestContext } from "./test-context";
import { createTboTransport } from "./transport";

/** The confirmation number of the recorded certification booking. */
const RECORDED_CONFIRMATION_NUMBER = "LVFXI5";

function makeAdapter() {
  return createTboHotelAdapter({ transport: createTboTransport({ mode: "replay" }) });
}

async function searchAndPick(): Promise<HotelOffer> {
  const adapter = makeAdapter();
  const offers = await adapter.search(makeTestContext(), RECORDED_SEARCH_QUERY);
  return pickLifecycleOffer(offers, new Date(RECORDED_SEARCH_INSTANT));
}

describe("TBO check (PreBook)", () => {
  it("revalidates the searched rate into a fresh canonical offer", async () => {
    const ctx = makeTestContext();
    const offer = await searchAndPick();
    const checked = await makeAdapter().check(ctx, offer.supplierOfferToken);
    assertHotelOffer(checked, ctx);
    expect(checked.net).toEqual(money(13973, "USD"));
    expect(checked.boardBasis).toBe("RO");
    expect(checked.cancellationPolicy.refundable).toBe(true);
  });

  it("rejects with price_changed when the revalidated fare differs from the priced one", async () => {
    const ctx = makeTestContext();
    const offer = await searchAndPick();
    // Same real PreBook response; the token claims a different priced fare.
    const tampered = encodeOfferToken({
      ...decodeOfferToken(offer.supplierOfferToken),
      totalFare: 99.99,
    });
    await expect(makeAdapter().check(ctx, tampered)).rejects.toMatchObject({
      kind: "price_changed",
    });
  });

  it("rejects with price_changed when the cancellation policy changed", async () => {
    const ctx = makeTestContext();
    const offer = await searchAndPick();
    const token = decodeOfferToken(offer.supplierOfferToken);
    const tampered = encodeOfferToken({
      ...token,
      policy: { refundable: token.policy.refundable, rules: [] },
    });
    await expect(makeAdapter().check(ctx, tampered)).rejects.toMatchObject({
      kind: "price_changed",
    });
  });
});

describe("TBO book / retrieve / cancel (recorded booking LVFXI5)", () => {
  it("books with the clientReference passed through and echoed by TBO", async () => {
    const ctx = makeTestContext();
    const checked = await makeAdapter().check(ctx, (await searchAndPick()).supplierOfferToken);
    const booked = await makeAdapter().book(ctx, makeRecordedBookRequest(checked));
    assertHotelBookingRecord(booked);
    expect(booked.supplierBookingReference).toBe(RECORDED_CONFIRMATION_NUMBER);
    // TBO echoes ClientReferenceId on the Book response (recorded live).
    expect(booked.clientReference).toBe(RECORDED_CLIENT_REFERENCE);
    expect(booked.status).toBe("confirmed");
    expect(booked.net).toEqual(money(13973, "USD"));
  });

  it("retrieves the stored booking with per-room fares aggregated", async () => {
    const ctx = makeTestContext();
    const retrieved = await makeAdapter().retrieve(ctx, RECORDED_CONFIRMATION_NUMBER);
    assertHotelBookingRecord(retrieved);
    expect(retrieved.supplierBookingReference).toBe(RECORDED_CONFIRMATION_NUMBER);
    expect(retrieved.net).toEqual(money(13973, "USD"));
    // The recording captures the booking during/after its real cancellation:
    // CancellationInProgress maps to pending, Cancelled to cancelled.
    expect(["pending", "cancelled"]).toContain(retrieved.status);
    // BookingDetail does not echo ClientReferenceId (verified live).
    expect(retrieved.clientReference).toBe("");
  });

  it("cancels and reports the supplier's stored state (async cancellation)", async () => {
    const ctx = makeTestContext();
    const cancelled = await makeAdapter().cancel(ctx, RECORDED_CONFIRMATION_NUMBER);
    assertHotelBookingRecord(cancelled);
    expect(cancelled.supplierBookingReference).toBe(RECORDED_CONFIRMATION_NUMBER);
    expect(["pending", "cancelled"]).toContain(cancelled.status);
    expect(cancelled.status).not.toBe("confirmed");
  });
});
