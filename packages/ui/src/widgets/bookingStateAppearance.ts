/**
 * BookingItemState → chip appearance mapping (pure — unit-tested).
 *
 * One appearance per canonical state (domain BOOKING_ITEM_STATES); the
 * escalated flag (booking_items.escalated_at — needs-a-human) overrides
 * everything with an alarm look. Labels are NOT mapped here — apps own
 * the ar/en catalogs and pass the localized label.
 */

import type { BookingItemState } from "@jenova/domain";

export type ChipTone = "default" | "primary" | "info" | "success" | "warning" | "error";

export interface BookingStateAppearance {
  readonly tone: ChipTone;
  /** outlined = settled/terminal look; filled = active/alarm look. */
  readonly variant: "filled" | "outlined";
}

const APPEARANCES: Readonly<Record<BookingItemState, BookingStateAppearance>> = {
  quoted: { tone: "default", variant: "outlined" },
  reserved: { tone: "info", variant: "filled" },
  pending_confirmation: { tone: "warning", variant: "filled" },
  confirmed: { tone: "success", variant: "filled" },
  issued: { tone: "primary", variant: "filled" },
  amendment_pending: { tone: "warning", variant: "filled" },
  completed: { tone: "success", variant: "outlined" },
  cancelled: { tone: "default", variant: "outlined" },
  failed: { tone: "error", variant: "filled" },
};

/** The alarm look: a human must intervene, whatever the state says. */
export const ESCALATED_APPEARANCE: BookingStateAppearance = {
  tone: "error",
  variant: "filled",
};

export function bookingStateAppearance(
  state: BookingItemState,
  escalated?: boolean,
): BookingStateAppearance {
  return escalated === true ? ESCALATED_APPEARANCE : APPEARANCES[state];
}
