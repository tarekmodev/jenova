// Harness mechanics only — no adapter exists at M0, so the contract suite
// must register itself skipped and the helpers must hold their own bar.
// Values below are canonical @jenova/domain structures, never supplier data.
import { describe, expect, it } from "vitest";
import { money, SupplierError } from "@jenova/domain";
import {
  assertHotelBookingRecord,
  assertHotelOffer,
  describeHotelAdapterContract,
  expectSupplierErrorKind,
} from "./harness";
import { formatCertificationReport } from "./report";

// The M0 registration: no adapter exists, so the whole suite reports skipped.
describeHotelAdapterContract(() => null, { supplierCode: "unregistered" });

describe("expectSupplierErrorKind", () => {
  it("passes when the call rejects with the expected kind", async () => {
    await expectSupplierErrorKind(
      () => Promise.reject(new SupplierError("sold_out", "gone")),
      "sold_out",
    );
  });

  it("fails when the call resolves", async () => {
    let failed = false;
    try {
      await expectSupplierErrorKind(() => Promise.resolve("ok"), "sold_out");
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it("fails when the kind differs", async () => {
    let failed = false;
    try {
      await expectSupplierErrorKind(
        () => Promise.reject(new SupplierError("rate_limited", "slow down")),
        "sold_out",
      );
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});

describe("structural assertion helpers", () => {
  it("assertHotelOffer accepts a canonical offer and rejects a blank token", () => {
    const offer = {
      supplierOfferToken: "tok-structural",
      canonicalPropertyId: "prop-structural",
      supplierRoomName: "room-structural",
      boardBasis: "BB",
      net: money(100_00, "SAR"),
      cancellationPolicy: { refundable: true, rules: [] },
      nationalityApplied: "SA",
    } as const;
    assertHotelOffer(offer);
    expect(() => assertHotelOffer({ ...offer, supplierOfferToken: "" })).toThrow();
  });

  it("assertHotelBookingRecord accepts a canonical record and rejects invalid money", () => {
    const record = {
      supplierBookingReference: "ref-structural",
      clientReference: "client-structural",
      status: "confirmed",
      net: money(100_00, "SAR"),
      cancellationPolicy: { refundable: false, rules: [] },
    } as const;
    assertHotelBookingRecord(record);
    expect(() =>
      assertHotelBookingRecord({ ...record, net: { amount: 0.5, currency: "SAR" } }),
    ).toThrow();
  });
});

describe("formatCertificationReport", () => {
  const run = {
    supplierCode: "structural",
    environment: "sandbox",
    ranAtUtc: "2026-08-30T00:00:00Z",
  } as const;

  it("renders metadata, one row per check, and counts", () => {
    const report = formatCertificationReport({ ...run, mode: "live" }, [
      { id: "lifecycle.search", title: "search returns offers", status: "passed" },
      { id: "error.sold_out", title: "maps sold_out", status: "todo", detail: "record first" },
    ]);
    expect(report).toContain("# Certification run: structural");
    expect(report).toContain("- Mode: live");
    expect(report).toContain("| lifecycle.search — search returns offers | PASS |");
    expect(report).toContain("| error.sold_out — maps sold_out | TODO | record first |");
    expect(report).toContain("2 (1 passed, 0 failed, 0 skipped, 1 todo)");
  });

  it("is CERTIFIABLE only for a clean live run", () => {
    const clean = [{ id: "a", title: "t", status: "passed" }] as const;
    expect(formatCertificationReport({ ...run, mode: "live" }, clean)).toContain(
      "Verdict: CERTIFIABLE",
    );
    expect(formatCertificationReport({ ...run, mode: "recorded" }, clean)).toContain(
      "Verdict: NOT CERTIFIABLE",
    );
    expect(
      formatCertificationReport({ ...run, mode: "live" }, [
        ...clean,
        { id: "b", title: "t", status: "failed" },
      ]),
    ).toContain("Verdict: NOT CERTIFIABLE");
  });
});
