/**
 * TBO transport wiring: retry/breaker client over the right inner seam
 * (docs/09-testing.md):
 *
 *   live   — UndiciTransport (production, and the pre-certification live run)
 *   record — sandbox-replay recorder around real fetch (development only;
 *            captures every request/response, sanitized before commit)
 *   replay — sandbox-replay replayer, recordings only (CI; a miss fails
 *            loudly with "record this scenario first")
 *
 * Retries stay bounded to idempotent operations (the client enforces it via
 * TransportRequest.idempotent) and one circuit breaker guards the account.
 */

import { createReplayTransport, type ReplayMode } from "@jenova/sandbox-replay";
import {
  CircuitBreaker,
  createFetchTransport,
  createSupplierHttpClient,
  type RetryPolicy,
  type Transport,
} from "@jenova/supplier-sdk";
import { TBO_SUPPLIER_CODE } from "./client";

export type TboTransportMode = "live" | ReplayMode;

export interface TboTransportOptions {
  readonly mode: TboTransportMode;
  /** Share one breaker per supplier account; a fresh one is made if omitted. */
  readonly breaker?: CircuitBreaker;
  readonly retry?: Partial<RetryPolicy>;
}

export function createTboTransport(options: TboTransportOptions): Transport {
  const breaker = options.breaker ?? new CircuitBreaker();
  const inner: Transport | undefined =
    options.mode === "live"
      ? undefined // createSupplierHttpClient defaults to UndiciTransport
      : createFetchTransport(
          createReplayTransport({
            mode: options.mode,
            supplier: TBO_SUPPLIER_CODE,
            // TBO tags every response with a `sessionid` header; treat it as
            // credential-adjacent and keep it out of committed recordings.
            redact: { headers: ["sessionid"] },
          }),
        );
  return createSupplierHttpClient({
    ...(inner === undefined ? {} : { transport: inner }),
    breaker,
    ...(options.retry === undefined ? {} : { retry: options.retry }),
  });
}
