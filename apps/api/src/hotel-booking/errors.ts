/**
 * Booking service error surface (issue #67) — typed refusals plus the HTTP
 * envelope mapping. Offer and supplier failures reuse the offers mapping
 * (unified taxonomy, CLAUDE.md rule 4); booking-engine's typed runner errors
 * map here so callers never see raw internals.
 */

import { HttpStatus } from "@nestjs/common";
import {
  BookingItemNotFoundError,
  BookingNotFoundError,
  TransitionConflictError,
} from "@jenova/booking-engine";
import { ApiHttpError } from "../gateway/errors";
import { isOfferError, SupplierUnavailableError, toOfferHttpError } from "../offers/errors";
import { isSupplierError } from "@jenova/domain";

export const BOOKING_ERROR_KINDS = [
  /** Unknown booking id, or a booking outside the caller's agency scope. */
  "booking_not_found",
  /** The item's current state does not allow the requested action. */
  "booking_not_cancellable",
  /** Request payload does not match the offer (rooms/guests mismatch, bad refs). */
  "booking_request_invalid",
  /**
   * Idempotency-key reuse with DIFFERENT parameters: the clientReference
   * already booked a different offer. Never answered with the original
   * booking — a partner bug reusing keys must hear a refusal, not a 201
   * for a hotel it did not ask for (Stripe-style idempotency contract).
   */
  "client_reference_conflict",
] as const;
export type BookingErrorKind = (typeof BOOKING_ERROR_KINDS)[number];

export class BookingError extends Error {
  constructor(
    readonly kind: BookingErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "BookingError";
  }
}

const BOOKING_ERROR_STATUS: Readonly<Record<BookingErrorKind, HttpStatus>> = {
  booking_not_found: HttpStatus.NOT_FOUND,
  booking_not_cancellable: HttpStatus.CONFLICT,
  booking_request_invalid: HttpStatus.BAD_REQUEST,
  client_reference_conflict: HttpStatus.CONFLICT,
};

/** Maps every booking-path failure onto the standard error envelope. */
export function toBookingHttpError(error: unknown): ApiHttpError {
  if (error instanceof BookingError) {
    return new ApiHttpError(error.kind, error.message, BOOKING_ERROR_STATUS[error.kind]);
  }
  if (error instanceof BookingNotFoundError || error instanceof BookingItemNotFoundError) {
    // Opaque like unknown offers: existence of other tenants'/agencies' ids
    // must not be probeable.
    return new ApiHttpError("booking_not_found", "unknown booking", HttpStatus.NOT_FOUND);
  }
  if (error instanceof TransitionConflictError) {
    return new ApiHttpError(
      "booking_conflict",
      "the booking changed state concurrently — re-read it and retry",
      HttpStatus.CONFLICT,
    );
  }
  if (isOfferError(error) || error instanceof SupplierUnavailableError || isSupplierError(error)) {
    return toOfferHttpError(error);
  }
  throw error;
}
