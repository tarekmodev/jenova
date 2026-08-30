/**
 * State → localized label, including the two OVERLAYS the row can carry:
 * escalation (manual intervention) and an async supplier cancel in flight.
 * Verdicts come from server fields only.
 */

import type { BookingItemState } from "@jenova/domain";
import type { Messages } from "../../i18n/messages";

export function stateLabel(messages: Messages, state: BookingItemState): string {
  return messages.states[state];
}

/** True while a supplier-side cancellation is pending settlement. */
export function cancellationInProgress(
  state: BookingItemState,
  cancellationRequestedAt: string | null,
): boolean {
  return cancellationRequestedAt !== null && state !== "cancelled" && state !== "failed";
}
