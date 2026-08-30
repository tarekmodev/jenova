/**
 * TBO → unified error taxonomy (CLAUDE.md rule 4). TBO signals failures two
 * ways: HTTP status (transport/auth layer) and the Status envelope inside a
 * 200 body. Both are mapped here; the original code and description ride
 * along on SupplierError for diagnostics only. The mapping table is built
 * from REAL recorded sandbox failures — see README.md for the observed
 * catalogue (M1.a4 #57).
 */

import { SupplierError, type SupplierErrorKind } from "@jenova/domain";
import type { TransportResponse } from "@jenova/supplier-sdk";
import type { TboStatus } from "./schemas";

/** TBO Status.Code values observed on real sandbox responses. */
export const TBO_STATUS_OK = 200;
/** search: "No Available rooms for given criteria" — empty result, not an error. */
export const TBO_STATUS_NO_ROOMS = 201;

/**
 * Status.Code → taxonomy kind for non-OK envelopes. Codes observed live are
 * documented in README.md; anything unlisted is supplier_rejected (the
 * supplier answered and refused).
 */
const STATUS_KIND: ReadonlyMap<number, SupplierErrorKind> = new Map([
  [TBO_STATUS_NO_ROOMS, "sold_out"],
]);

/**
 * Description-based refinement for TBO's catch-all codes: the sandbox
 * reports several distinct failures under one Status.Code, so the
 * description text (recorded verbatim in recordings/tbo) disambiguates.
 */
const DESCRIPTION_KIND: readonly { pattern: RegExp; kind: SupplierErrorKind }[] = [];

export function supplierErrorFromStatus(status: TboStatus, operation: string): SupplierError {
  for (const { pattern, kind } of DESCRIPTION_KIND) {
    if (pattern.test(status.Description)) {
      return new SupplierError(kind, `TBO ${operation}: ${status.Description}`, {
        supplierCode: String(status.Code),
        raw: status,
      });
    }
  }
  const kind = STATUS_KIND.get(status.Code) ?? "supplier_rejected";
  return new SupplierError(kind, `TBO ${operation}: ${status.Description}`, {
    supplierCode: String(status.Code),
    raw: status,
  });
}

/** HTTP-level failures (non-2xx). 401 observed live with wrong credentials. */
export function supplierErrorFromHttp(
  response: TransportResponse,
  operation: string,
): SupplierError {
  const kind: SupplierErrorKind =
    response.status === 401 || response.status === 403
      ? "auth_failed"
      : response.status === 429
        ? "rate_limited"
        : response.status === 408 || response.status === 504
          ? "supplier_timeout"
          : "supplier_rejected";
  return new SupplierError(kind, `TBO ${operation}: HTTP ${response.status}`, {
    supplierCode: String(response.status),
    raw: response.body.slice(0, 2_000),
  });
}
