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
/**
 * "No Available rooms for given criteria" — observed live on a broad search
 * with no availability AND on PreBook of an expired BookingCode (TBO does
 * not distinguish expiry from sold-out). search maps it to an empty result;
 * every other operation maps it to sold_out.
 */
export const TBO_STATUS_NO_ROOMS = 201;

/**
 * Status.Code → taxonomy kind for non-OK envelopes, from REAL recorded
 * sandbox failures (each code's recording is committed; the full observed
 * catalogue is the README's taxonomy table):
 *   201 "No Available rooms for given criteria"            → sold_out
 *   315 "Session Expired or doesn't exist" (dead/expired
 *       BookingCode on PreBook)                            → price_changed
 *   400 "Invalid date entered. CheckIn date should be…"    → invalid_request
 *   400 "Booking does not exist for the requested input"   → invalid_request
 *   401 "Access Credentials is incorrect" (HTTP 200!)      → auth_failed
 *   479 "No Itinerary exist for this input"                → supplier_rejected
 * Anything unlisted is supplier_rejected (the supplier answered and
 * refused); timeouts/aborts never reach here (the transport raises
 * supplier_timeout itself).
 */
const STATUS_KIND: ReadonlyMap<number, SupplierErrorKind> = new Map([
  [TBO_STATUS_NO_ROOMS, "sold_out"],
  // The rate token behind the offer is gone — the offer must be re-priced.
  [315, "price_changed"],
  [400, "invalid_request"],
  [401, "auth_failed"],
  [403, "auth_failed"],
  [429, "rate_limited"],
  [479, "supplier_rejected"],
]);

export function supplierErrorFromStatus(status: TboStatus, operation: string): SupplierError {
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
