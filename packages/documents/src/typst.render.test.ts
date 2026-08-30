/**
 * Typst rendering pipeline tests: DETERMINISM (Typst + pinned fonts +
 * date: none → byte-identical output for identical input) and template
 * mechanics. Skips when no Typst binary is installed (CI can run the pure
 * suites without it; the compose-based proof runs this live).
 *
 * Inputs are minimal STRUCTURAL values — this suite tests layout/pipeline
 * mechanics only (CLAUDE.md rule 5 note); the recorded-booking render lives
 * in the api's documents integration suite.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TypstRenderer, typstAvailable, VOUCHER_TEMPLATE, DocumentRenderError } from "./typst";
import { buildVoucherTemplateInput, type VoucherData } from "./voucher-content";

const DATA: VoucherData = {
  bookingId: "00000000-0000-0000-0000-000000000001",
  bookingItemId: "00000000-0000-0000-0000-000000000002",
  clientReference: "STRUCT-REF-1",
  supplierReference: "STRUCT-CONF-1",
  property: { canonicalId: "structural:property-1", name: "فندق هيكلي للاختبار" },
  stay: { checkIn: "2026-10-13", checkOut: "2026-10-14", nights: 1 },
  boardBasis: "RO",
  roomName: "Structural Room",
  nationality: "SA",
  guests: {
    holder: {
      firstName: "حامل",
      lastName: "الحجز",
      email: "holder@example.invalid",
      phone: "0000000000",
    },
    rooms: [{ guests: [{ firstName: "ضيف", lastName: "الاختبار" }] }],
  },
  sell: { amount: 52_400, currency: "SAR" },
  policy: {
    refundable: false,
    rules: [{ fromUtc: "2026-08-30T00:00:00Z", penalty: { amount: 52_400, currency: "SAR" } }],
  },
  brand: { legalName: "شركة هيكلية للسفر", brandColor: "#1f4e79", logoPng: null },
};

const available = await typstAvailable(process.env["DOCUMENTS_TYPST_BIN"] ?? "typst");
const renderer = () =>
  new TypstRenderer(
    process.env["DOCUMENTS_TYPST_BIN"] === undefined
      ? {}
      : { bin: process.env["DOCUMENTS_TYPST_BIN"] },
  );

describe.skipIf(!available)("TypstRenderer — voucher template", () => {
  it("produces a PDF, byte-identical across renders of the same input", async () => {
    const input = buildVoucherTemplateInput(DATA, "ar", null);
    const first = await renderer().render({ templatePath: VOUCHER_TEMPLATE, data: input });
    const second = await renderer().render({ templatePath: VOUCHER_TEMPLATE, data: input });
    expect(first.byteLength).toBeGreaterThan(1_000);
    expect(Buffer.from(first.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    expect(sha(second)).toBe(sha(first)); // Typst determinism — asserted, not assumed
  });

  it("different input produces different bytes (the assertion above is not vacuous)", async () => {
    const a = await renderer().render({
      templatePath: VOUCHER_TEMPLATE,
      data: buildVoucherTemplateInput(DATA, "ar", null),
    });
    const b = await renderer().render({
      templatePath: VOUCHER_TEMPLATE,
      data: buildVoucherTemplateInput(
        { ...DATA, supplierReference: "STRUCT-CONF-2" },
        "ar",
        null,
      ),
    });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("embeds a provided logo file from the compilation root", async () => {
    // 1x1 transparent PNG (structural pixel, generated — not an asset of anything).
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==",
      "base64",
    );
    const withLogo = await renderer().render({
      templatePath: VOUCHER_TEMPLATE,
      data: buildVoucherTemplateInput({ ...DATA, brand: { ...DATA.brand, logoPng: pixel } }, "ar", "logo.png"),
      files: { "logo.png": pixel },
    });
    expect(Buffer.from(withLogo.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("refuses extra files that are not bare filenames (no path escape from the root)", async () => {
    await expect(
      renderer().render({
        templatePath: VOUCHER_TEMPLATE,
        data: buildVoucherTemplateInput(DATA, "ar", null),
        files: { "../escape.png": new Uint8Array(1) },
      }),
    ).rejects.toThrow(DocumentRenderError);
  });
});

describe.skipIf(available)("TypstRenderer — binary missing", () => {
  it("typstAvailable answered false (suite skipped live rendering)", () => {
    expect(available).toBe(false);
  });
});
