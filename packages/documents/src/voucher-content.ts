/**
 * Voucher content assembly (issue #99; CLAUDE.md rule 9): one bilingual
 * document — Arabic primary RTL, English mirror — built as display-ready
 * strings the Typst template renders verbatim. Data flows into the template
 * as JSON via `sys.inputs` (never string-spliced into Typst markup), so no
 * guest name or hotel name can ever be interpreted as markup.
 *
 * NET-FREE BY CONSTRUCTION: `VoucherData` carries only the sell price — a
 * voucher never shows what the tenant paid the supplier.
 */

import type { CancellationPolicy, Locale, Money } from "@jenova/domain";
import type { BookingGuestsSnapshot } from "@jenova/db";
import {
  formatGregorianDate,
  formatHijriDate,
  formatMoney,
  formatUtcInstant,
} from "./format";

/** Tenant identity + branding pulled from the control-plane Tenant row. */
export interface VoucherBrand {
  readonly legalName: string;
  /** `#rrggbb`; null falls back to the neutral default. */
  readonly brandColor: string | null;
  /** PNG bytes for the logo slot; null renders the legal name as the mark. */
  readonly logoPng: Uint8Array | null;
}

/** Everything a hotel voucher renders — assembled by the data loader. */
export interface VoucherData {
  readonly bookingId: string;
  readonly bookingItemId: string;
  readonly clientReference: string;
  readonly supplierReference: string;
  readonly property: { readonly canonicalId: string; readonly name: string | null };
  readonly stay: { readonly checkIn: string; readonly checkOut: string; readonly nights: number };
  readonly boardBasis: string | null;
  readonly roomName: string | null;
  readonly nationality: string | null;
  readonly guests: BookingGuestsSnapshot;
  /** Sell price only — vouchers are net-free. */
  readonly sell: Money;
  readonly policy: CancellationPolicy;
  readonly brand: VoucherBrand;
}

interface SectionRow {
  readonly label: string;
  readonly value: string;
}

interface TemplateSection {
  readonly lang: "ar" | "en";
  readonly dir: "rtl" | "ltr";
  readonly title: string;
  readonly rows: readonly SectionRow[];
  readonly policyTitle: string;
  readonly policyLines: readonly string[];
}

/** The JSON shape `assets/voucher.typ` consumes through `sys.inputs.data`. */
export interface VoucherTemplateInput {
  readonly brand: {
    readonly name: string;
    readonly color: string;
    /** Filename of a PNG placed in the compilation root, or null. */
    readonly logo: string | null;
  };
  readonly confirmation: string;
  readonly footer: string;
  readonly sections: readonly TemplateSection[];
}

const DEFAULT_BRAND_COLOR = "#1f4e79";
const BRAND_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const BOARD_BASIS_LABELS: Readonly<Record<string, { ar: string; en: string }>> = {
  RO: { ar: "غرفة فقط", en: "Room only" },
  BB: { ar: "مع إفطار", en: "Bed & breakfast" },
  HB: { ar: "نصف إقامة", en: "Half board" },
  FB: { ar: "إقامة كاملة", en: "Full board" },
  AI: { ar: "شامل جميع الخدمات", en: "All inclusive" },
};

function boardBasisLabel(code: string, lang: "ar" | "en"): string {
  const labels = BOARD_BASIS_LABELS[code];
  return labels === undefined ? code : `${labels[lang]} (${code})`;
}

/** `13 أكتوبر 2026 (١ جمادى الأولى ١٤٤٨ هـ)` — Gregorian primary, Hijri secondary (rule 9). */
function dualDate(isoDate: string, lang: "ar" | "en"): string {
  const gregorian = formatGregorianDate(isoDate, lang);
  const hijri = formatHijriDate(isoDate, lang);
  return lang === "ar" ? `${gregorian} (${hijri} هـ)` : `${gregorian} (${hijri} AH)`;
}

function guestLines(guests: BookingGuestsSnapshot, lang: "ar" | "en"): string {
  const roomWord = lang === "ar" ? "غرفة" : "Room";
  return guests.rooms
    .map((room, index) => {
      const names = room.guests
        .map((guest) => `${guest.firstName} ${guest.lastName}`)
        .join(lang === "ar" ? "، " : ", ");
      return guests.rooms.length === 1 ? names : `${roomWord} ${String(index + 1)}: ${names}`;
    })
    .join(lang === "ar" ? " — " : " — ");
}

function policyLines(policy: CancellationPolicy, lang: "ar" | "en"): readonly string[] {
  const lines: string[] = [];
  lines.push(
    policy.refundable
      ? lang === "ar"
        ? "الحجز قابل للاسترداد وفق المواعيد التالية."
        : "This booking is refundable per the deadlines below."
      : lang === "ar"
        ? "الحجز غير قابل للاسترداد."
        : "This booking is non-refundable.",
  );
  for (const rule of policy.rules) {
    const from = formatUtcInstant(rule.fromUtc);
    if (rule.penalty.amount === 0) {
      lines.push(
        lang === "ar" ? `اعتباراً من ${from}: إلغاء مجاني` : `From ${from}: free cancellation`,
      );
    } else {
      const penalty = formatMoney(rule.penalty);
      lines.push(
        lang === "ar"
          ? `اعتباراً من ${from}: غرامة إلغاء ${penalty}`
          : `From ${from}: cancellation penalty ${penalty}`,
      );
    }
  }
  if (policy.rules.length === 0 && policy.refundable) {
    lines.push(
      lang === "ar"
        ? "لا توجد غرامات إلغاء مسجلة لهذا الحجز."
        : "No cancellation penalties are recorded for this booking.",
    );
  }
  return lines;
}

function section(data: VoucherData, lang: "ar" | "en"): TemplateSection {
  const ar = lang === "ar";
  const propertyName = data.property.name ?? data.property.canonicalId;
  const rows: SectionRow[] = [
    { label: ar ? "الفندق" : "Property", value: propertyName },
    { label: ar ? "المعرّف الموحّد للفندق" : "Property ID", value: data.property.canonicalId },
    {
      label: ar ? "رقم تأكيد المزوّد" : "Supplier confirmation",
      value: data.supplierReference,
    },
    { label: ar ? "مرجع الحجز" : "Booking reference", value: data.clientReference },
    { label: ar ? "تاريخ الوصول" : "Check-in", value: dualDate(data.stay.checkIn, lang) },
    { label: ar ? "تاريخ المغادرة" : "Check-out", value: dualDate(data.stay.checkOut, lang) },
    { label: ar ? "عدد الليالي" : "Nights", value: String(data.stay.nights) },
    {
      label: ar ? "حامل الحجز" : "Booking holder",
      value: `${data.guests.holder.firstName} ${data.guests.holder.lastName}`,
    },
    { label: ar ? "الضيوف" : "Guests", value: guestLines(data.guests, lang) },
  ];
  if (data.roomName !== null) {
    rows.push({ label: ar ? "الغرفة" : "Room", value: data.roomName });
  }
  if (data.boardBasis !== null) {
    rows.push({
      label: ar ? "نظام الإقامة" : "Board basis",
      value: boardBasisLabel(data.boardBasis, lang),
    });
  }
  if (data.nationality !== null) {
    rows.push({ label: ar ? "جنسية الضيوف" : "Guest nationality", value: data.nationality });
  }
  rows.push({ label: ar ? "السعر الإجمالي" : "Total price", value: formatMoney(data.sell) });
  return {
    lang,
    dir: ar ? "rtl" : "ltr",
    title: ar ? "قسيمة إقامة فندقية" : "Hotel Accommodation Voucher",
    rows,
    policyTitle: ar ? "سياسة الإلغاء" : "Cancellation policy",
    policyLines: policyLines(data.policy, lang),
  };
}

/**
 * Assembles the template input. `primary` decides which language leads; BOTH
 * are always present — every document ships Arabic AND English from its
 * first commit (CLAUDE.md rule 9).
 */
export function buildVoucherTemplateInput(
  data: VoucherData,
  primary: Locale,
  logoFileName: string | null,
): VoucherTemplateInput {
  const color =
    data.brand.brandColor !== null && BRAND_COLOR_RE.test(data.brand.brandColor)
      ? data.brand.brandColor
      : DEFAULT_BRAND_COLOR;
  const arabic = section(data, "ar");
  const english = section(data, "en");
  return {
    brand: { name: data.brand.legalName, color, logo: logoFileName },
    confirmation: data.supplierReference,
    footer: `${data.bookingId} · ${data.bookingItemId}`,
    sections: primary === "en" ? [english, arabic] : [arabic, english],
  };
}
