/**
 * Bilingual voucher email templates (issue #100; CLAUDE.md rule 9): Arabic
 * primary, English mirror, in one plain-text message with the voucher PDF
 * attached. Sell-side content only — like the voucher, the email never
 * mentions net.
 */

import { formatGregorianDate } from "./format";
import type { VoucherData } from "./voucher-content";

export interface VoucherEmailContent {
  readonly subject: string;
  readonly text: string;
  readonly attachmentFilename: string;
}

export function buildVoucherEmail(data: VoucherData): VoucherEmailContent {
  const property = data.property.name ?? data.property.canonicalId;
  const holder = `${data.guests.holder.firstName} ${data.guests.holder.lastName}`;
  const checkInAr = formatGregorianDate(data.stay.checkIn, "ar");
  const checkOutAr = formatGregorianDate(data.stay.checkOut, "ar");
  const checkInEn = formatGregorianDate(data.stay.checkIn, "en");
  const checkOutEn = formatGregorianDate(data.stay.checkOut, "en");

  const subject = `تأكيد الحجز ${data.supplierReference} | Booking confirmed ${data.supplierReference} — ${property}`;

  const text = [
    `عزيزنا ${holder}،`,
    "",
    `تم تأكيد حجزكم في ${property}.`,
    `رقم تأكيد المزوّد: ${data.supplierReference}`,
    `الوصول: ${checkInAr} — المغادرة: ${checkOutAr}`,
    "تجدون قسيمة الإقامة مرفقة بهذه الرسالة. يرجى إبرازها عند الوصول.",
    "",
    "----------------------------------------",
    "",
    `Dear ${holder},`,
    "",
    `Your booking at ${property} is confirmed.`,
    `Supplier confirmation: ${data.supplierReference}`,
    `Check-in: ${checkInEn} — Check-out: ${checkOutEn}`,
    "Your accommodation voucher is attached. Please present it at check-in.",
    "",
    data.brand.legalName,
  ].join("\n");

  return {
    subject,
    text,
    attachmentFilename: `voucher-${data.supplierReference}.pdf`,
  };
}
