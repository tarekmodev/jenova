import { describe, expect, it } from "vitest";
import { money, tenantId } from "@jenova/domain";
import {
  BOARD_BASES,
  isBoardBasis,
  isSupplierEnvironment,
  SUPPLIER_BOOKING_STATUSES,
  SUPPLIER_ENVIRONMENTS,
  type AdapterCallContext,
  type HotelSearchQuery,
  type HotelSupplierAdapter,
} from "./contracts";

describe("supplier environments", () => {
  it("covers exactly sandbox and production", () => {
    expect(SUPPLIER_ENVIRONMENTS).toEqual(["sandbox", "production"]);
  });

  it("guards environments at runtime", () => {
    expect(isSupplierEnvironment("sandbox")).toBe(true);
    expect(isSupplierEnvironment("production")).toBe(true);
    expect(isSupplierEnvironment("staging")).toBe(false);
    expect(isSupplierEnvironment("SANDBOX")).toBe(false);
  });
});

describe("board bases", () => {
  it("covers exactly the five canonical codes", () => {
    expect(BOARD_BASES).toEqual(["RO", "BB", "HB", "FB", "AI"]);
  });

  it("guards board bases at runtime", () => {
    for (const basis of BOARD_BASES) {
      expect(isBoardBasis(basis)).toBe(true);
    }
    expect(isBoardBasis("ro")).toBe(false);
    expect(isBoardBasis("HALF_BOARD")).toBe(false);
  });
});

describe("supplier booking statuses", () => {
  it("covers confirmed, pending, cancelled", () => {
    expect(SUPPLIER_BOOKING_STATUSES).toEqual(["confirmed", "pending", "cancelled"]);
  });
});

describe("contract shapes", () => {
  it("compose from @jenova/domain canonical types (compile-time contract)", () => {
    // Structural exercise of our own canonical types — not supplier data.
    const ctx: AdapterCallContext = {
      credentials: {
        tenantId: tenantId("t-structural"),
        supplierCode: "structural",
        environment: "sandbox",
        secrets: {},
      },
      deadline: new Date(Date.now() + 5_000),
      nationality: "SA",
      currency: money(0, "SAR").currency,
      locale: "ar",
    };
    expect(ctx.credentials.environment).toBe("sandbox");

    const query: HotelSearchQuery = {
      target: { kind: "location", canonicalLocationId: "loc-structural" },
      checkIn: "2026-01-01",
      checkOut: "2026-01-02",
      rooms: [{ adults: 2, childAges: [] }],
    };
    expect(query.rooms).toHaveLength(1);

    // The hotel lifecycle is exactly search/check/book/retrieve/cancel.
    const lifecycle: readonly (keyof HotelSupplierAdapter)[] = [
      "search",
      "check",
      "book",
      "retrieve",
      "cancel",
    ];
    expect(lifecycle).toHaveLength(5);
  });
});
