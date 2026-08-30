/**
 * BookingStateChip (every canonical state + escalated override) and
 * PolicyTimeline (refundable + non-refundable shapes). Synthetic
 * structural policies with round amounts (CLAUDE.md rule 5).
 */

import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  BOOKING_ITEM_STATES,
  money,
  type BookingItemState,
  type CancellationPolicy,
} from "@jenova/domain";
import { BookingStateChip } from "../widgets/BookingStateChip";
import { PolicyTimeline } from "../widgets/PolicyTimeline";
import { pickCopy, STORY_NOW } from "./support";

const meta: Meta = {
  title: "Widgets/Booking",
};
export default meta;

const STATE_LABELS: Record<"ar" | "en", Record<BookingItemState, string>> = {
  ar: {
    quoted: "مُسعّر",
    reserved: "محجوز",
    pending_confirmation: "بانتظار التأكيد",
    confirmed: "مؤكد",
    issued: "صادر",
    amendment_pending: "تعديل قيد التنفيذ",
    completed: "مكتمل",
    cancelled: "ملغى",
    failed: "فشل",
  },
  en: {
    quoted: "Quoted",
    reserved: "Reserved",
    pending_confirmation: "Pending confirmation",
    confirmed: "Confirmed",
    issued: "Issued",
    amendment_pending: "Amendment pending",
    completed: "Completed",
    cancelled: "Cancelled",
    failed: "Failed",
  },
};

export const StateChips: StoryObj = {
  render: (_args, context) => {
    const copy = pickCopy(context.globals, {
      ar: { all: "كل الحالات", escalated: "التصعيد يتجاوز أي حالة", labels: STATE_LABELS.ar },
      en: { all: "Every state", escalated: "Escalation overrides any state", labels: STATE_LABELS.en },
    });
    return (
      <Stack spacing={3}>
        <Stack spacing={1}>
          <Typography variant="h6">{copy.all}</Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {BOOKING_ITEM_STATES.map((state) => (
              <BookingStateChip key={state} state={state} label={copy.labels[state]} />
            ))}
          </Stack>
        </Stack>
        <Stack spacing={1}>
          <Typography variant="h6">{copy.escalated}</Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <BookingStateChip state="pending_confirmation" label={copy.labels.pending_confirmation} escalated />
            <BookingStateChip state="confirmed" label={copy.labels.confirmed} escalated />
          </Stack>
        </Stack>
      </Stack>
    );
  },
};

// Synthetic structural policy: two deadline steps around STORY_NOW.
const REFUNDABLE_POLICY: CancellationPolicy = {
  refundable: true,
  rules: [
    { fromUtc: "2026-03-10T00:00:00Z", penalty: money(10000, "SAR") },
    { fromUtc: "2026-03-15T00:00:00Z", penalty: money(50000, "SAR") },
  ],
};

const NON_REFUNDABLE_POLICY: CancellationPolicy = {
  refundable: false,
  rules: [{ fromUtc: "2026-03-01T00:00:00Z", penalty: money(50000, "SAR") }],
};

export const CancellationTimeline: StoryObj = {
  render: (_args, context) => {
    const copy = pickCopy(context.globals, {
      ar: {
        refundable: "سياسة قابلة للاسترداد",
        nonRefundable: "سياسة غير قابلة للاسترداد",
        labels: {
          free: "إلغاء مجاني",
          nonRefundable: "غير قابل للاسترداد",
          until: "حتى",
          from: "من",
          now: "الآن",
        },
      },
      en: {
        refundable: "Refundable policy",
        nonRefundable: "Non-refundable policy",
        labels: {
          free: "Free cancellation",
          nonRefundable: "Non-refundable",
          until: "until",
          from: "from",
          now: "now",
        },
      },
    });
    return (
      <Stack spacing={4} sx={{ maxWidth: 480 }}>
        <Stack spacing={1.5}>
          <Typography variant="h6">{copy.refundable}</Typography>
          <PolicyTimeline policy={REFUNDABLE_POLICY} labels={copy.labels} now={STORY_NOW} hijri />
        </Stack>
        <Stack spacing={1.5}>
          <Typography variant="h6">{copy.nonRefundable}</Typography>
          <PolicyTimeline policy={NON_REFUNDABLE_POLICY} labels={copy.labels} now={STORY_NOW} />
        </Stack>
      </Stack>
    );
  },
};
