/**
 * Offer-store error surface (issues #64/#65).
 *
 * `OfferError` covers offer lifecycle refusals; supplier failures during
 * `check` arrive as @jenova/domain SupplierError (the unified taxonomy,
 * CLAUDE.md rule 4) and both map onto the gateway's standard error envelope
 * in {@link toOfferHttpError}.
 *
 * Deliberate opacity: an unknown offer id, a tampered signature, a row this
 * agency does not own, and a row predating the offer-store columns are ALL
 * `offer_not_found` — distinguishing them would hand a tampering client an
 * oracle over which field it got wrong. Expiry IS distinguishable: expiry is
 * inside the signature, so only a legitimately signed offer can ever be told
 * apart as "expired".
 */

import { HttpStatus } from "@nestjs/common";
import { isSupplierError, type SupplierErrorKind } from "@jenova/domain";
import { ApiHttpError } from "../gateway/errors";

export const OFFER_ERROR_KINDS = [
  /** Unknown, tampered, foreign, or structurally unverifiable offer. */
  "offer_not_found",
  /** Signature valid, but the server clock passed the signed expiry. */
  "offer_expired",
  /** Invalidated: superseded by a re-priced successor or killed (sold_out). */
  "offer_invalidated",
  /** Booking guard: no sufficiently recent successful `check`. */
  "offer_not_checked",
] as const;
export type OfferErrorKind = (typeof OFFER_ERROR_KINDS)[number];

export class OfferError extends Error {
  constructor(
    readonly kind: OfferErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "OfferError";
  }
}

export function isOfferError(value: unknown): value is OfferError {
  return value instanceof OfferError;
}

/** No adapter is deployed for this supplier code (e.g. not yet merged). */
export class SupplierUnavailableError extends Error {
  constructor(readonly supplierCode: string) {
    super(`no adapter is available for supplier ${supplierCode}`);
    this.name = "SupplierUnavailableError";
  }
}

const OFFER_ERROR_STATUS: Readonly<Record<OfferErrorKind, HttpStatus>> = {
  offer_not_found: HttpStatus.NOT_FOUND,
  offer_expired: HttpStatus.GONE,
  offer_invalidated: HttpStatus.GONE,
  offer_not_checked: HttpStatus.CONFLICT,
};

/**
 * Supplier taxonomy → envelope status. 4xx where the CLIENT must act
 * (re-search, re-approve, slow down); 502/504 where the supplier side
 * failed and a retry may help.
 */
const SUPPLIER_ERROR_STATUS: Readonly<Record<SupplierErrorKind, { code: string; status: HttpStatus }>> = {
  sold_out: { code: "sold_out", status: HttpStatus.GONE },
  price_changed: { code: "price_changed", status: HttpStatus.CONFLICT },
  invalid_request: { code: "supplier_rejected", status: HttpStatus.BAD_GATEWAY },
  supplier_timeout: { code: "supplier_timeout", status: HttpStatus.GATEWAY_TIMEOUT },
  supplier_rejected: { code: "supplier_rejected", status: HttpStatus.BAD_GATEWAY },
  auth_failed: { code: "supplier_auth_failed", status: HttpStatus.BAD_GATEWAY },
  rate_limited: { code: "rate_limited", status: HttpStatus.TOO_MANY_REQUESTS },
};

/** Maps offer/supplier failures onto the standard `{error:{code,...}}` envelope. */
export function toOfferHttpError(error: unknown): ApiHttpError {
  if (isOfferError(error)) {
    return new ApiHttpError(error.kind, error.message, OFFER_ERROR_STATUS[error.kind]);
  }
  if (error instanceof SupplierUnavailableError) {
    return new ApiHttpError(
      "supplier_unavailable",
      "this supplier is not available right now",
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  if (isSupplierError(error)) {
    const mapped = SUPPLIER_ERROR_STATUS[error.kind];
    // Never forward supplier text to clients — kind is the whole story.
    return new ApiHttpError(mapped.code, `supplier check failed: ${error.kind}`, mapped.status);
  }
  throw error;
}
