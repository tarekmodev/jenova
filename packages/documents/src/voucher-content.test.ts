/**
 * Voucher content-assembly units: layout/binding mechanics only, driven by
 * minimal STRUCTURAL values (no supplier-shaped data — CLAUDE.md rule 5;
 * the real-recording end-to-end lives in the api's documents integration
 * suite).
 */

import { describe, expect, it } from "vitest";
import { buildVoucherTemplateInput, type VoucherData } from "./voucher-content";

const DATA: VoucherData = {
  bookingId: "00000000-0000-0000-0000-000000000001",
  bookingItemId: "00000000-0000-0000-0000-000000000002",
  clientReference: "STRUCT-REF-1",
  supplierReference: "STRUCT-CONF-1",
  property: { canonicalId: "structural:property-1", name: "Structural Property" },
  stay: { checkIn: "2026-10-13", checkOut: "2026-10-14", nights: 1 },
  boardBasis: "BB",
  roomName: "Structural Room",
  nationality: "SA",
  guests: {
    holder: {
      firstName: "Holder",
      lastName: "Structural",
      email: "holder@example.invalid",
      phone: "0000000000",
    },
    rooms: [{ guests: [{ firstName: "Guest", lastName: "Structural" }] }],
  },
  sell: { amount: 52_400, currency: "SAR" },
  policy: {
    refundable: true,
    rules: [
      { fromUtc: "2026-10-10T23:59:00Z", penalty: { amount: 0, currency: "SAR" } },
      { fromUtc: "2026-10-12T00:00:00Z", penalty: { amount: 13_973, currency: "SAR" } },
    ],
  },
  brand: { legalName: "Structural Travel LLC", brandColor: "#123456", logoPng: null },
};

describe("buildVoucherTemplateInput", () => {
  it("always carries BOTH language sections — Arabic primary by default (rule 9)", () => {
    const input = buildVoucherTemplateInput(DATA, "ar", null);
    expect(input.sections.map((s) => s.lang)).toEqual(["ar", "en"]);
    expect(input.sections[0]?.dir).toBe("rtl");
    expect(input.sections[1]?.dir).toBe("ltr");
    expect(input.sections[0]?.title).toBe("قسيمة إقامة فندقية");
    expect(input.sections[1]?.title).toBe("Hotel Accommodation Voucher");
  });

  it("locale=en flips the leading section, never drops one", () => {
    const input = buildVoucherTemplateInput(DATA, "en", null);
    expect(input.sections.map((s) => s.lang)).toEqual(["en", "ar"]);
  });

  it("is NET-FREE: the template input never carries a net key or amount", () => {
    const json = JSON.stringify(buildVoucherTemplateInput(DATA, "ar", null));
    expect(json).not.toMatch(/"net/i);
    // The sell price appears in every section; nothing else money-shaped does.
    for (const section of buildVoucherTemplateInput(DATA, "ar", null).sections) {
      const priceRows = section.rows.filter((r) => r.value.includes("524.00 SAR"));
      expect(priceRows).toHaveLength(1);
    }
  });

  it("renders stay dates Gregorian-primary with Hijri secondary", () => {
    const input = buildVoucherTemplateInput(DATA, "ar", null);
    const ar = input.sections[0];
    const en = input.sections[1];
    const arCheckIn = ar?.rows.find((r) => r.label === "تاريخ الوصول")?.value ?? "";
    const enCheckIn = en?.rows.find((r) => r.label === "Check-in")?.value ?? "";
    expect(arCheckIn).toContain("أكتوبر"); // Gregorian month, Arabic
    expect(arCheckIn).toContain("هـ"); // Hijri secondary, labeled
    expect(enCheckIn).toContain("13 October 2026");
    expect(enCheckIn).toContain("AH");
    expect(enCheckIn).toContain("1448");
  });

  it("renders the normalized cancellation policy as deadline lines in both languages", () => {
    const input = buildVoucherTemplateInput(DATA, "ar", null);
    const [ar, en] = input.sections;
    expect(ar?.policyLines.some((l) => l.includes("2026-10-10 23:59 UTC") && l.includes("مجاني"))).toBe(true);
    expect(ar?.policyLines.some((l) => l.includes("139.73 SAR") && l.includes("غرامة"))).toBe(true);
    expect(en?.policyLines).toContain("From 2026-10-10 23:59 UTC: free cancellation");
    expect(en?.policyLines).toContain("From 2026-10-12 00:00 UTC: cancellation penalty 139.73 SAR");
  });

  it("labels the board basis bilingually and keeps property id + confirmation", () => {
    const input = buildVoucherTemplateInput(DATA, "ar", null);
    const [ar, en] = input.sections;
    expect(ar?.rows.find((r) => r.label === "نظام الإقامة")?.value).toBe("مع إفطار (BB)");
    expect(en?.rows.find((r) => r.label === "Board basis")?.value).toBe("Bed & breakfast (BB)");
    expect(en?.rows.find((r) => r.label === "Property ID")?.value).toBe("structural:property-1");
    expect(input.confirmation).toBe("STRUCT-CONF-1");
  });

  it("falls back to the canonical id when no property name is known, and to the default brand color", () => {
    const input = buildVoucherTemplateInput(
      {
        ...DATA,
        property: { canonicalId: "structural:property-1", name: null },
        brand: { ...DATA.brand, brandColor: "papayawhip" },
      },
      "ar",
      null,
    );
    expect(input.sections[1]?.rows.find((r) => r.label === "Property")?.value).toBe(
      "structural:property-1",
    );
    expect(input.brand.color).toBe("#1f4e79");
  });

  it("threads the logo filename into the brand block when a logo exists", () => {
    expect(buildVoucherTemplateInput(DATA, "ar", "logo.png").brand.logo).toBe("logo.png");
    expect(buildVoucherTemplateInput(DATA, "ar", null).brand.logo).toBeNull();
  });
});
