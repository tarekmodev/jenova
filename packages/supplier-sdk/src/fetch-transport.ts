/**
 * Fetch-shaped Transport bridge (docs/09-testing.md).
 *
 * @jenova/sandbox-replay speaks the (url, init) fetch shape; the supplier
 * transport stack speaks {@link Transport}. This bridge lets the recorder
 * (development) or replayer (CI) sit INSIDE the retry/breaker client:
 *
 *   createSupplierHttpClient({ transport: createFetchTransport(replayFetch) })
 *
 * so recorded and live runs differ only by injection, never by code path.
 * Like UndiciTransport, it cuts an AbortSignal from the context deadline and
 * maps every transport-level failure to SupplierError(supplier_timeout).
 */

import { SupplierError } from "@jenova/domain";
import type { AdapterCallContext } from "./contracts";
import type { Transport, TransportResponse } from "./transport";

/** Structural subset of fetch — matches @jenova/sandbox-replay's FetchLike. */
export type FetchFn = (url: string | URL, init?: RequestInit) => Promise<Response>;

export function createFetchTransport(fetchFn: FetchFn): Transport {
  return {
    async send(request, ctx: AdapterCallContext): Promise<TransportResponse> {
      const remaining = ctx.deadline.getTime() - Date.now();
      if (remaining <= 0) {
        throw new SupplierError(
          "supplier_timeout",
          `deadline exhausted calling ${ctx.credentials.supplierCode} (${ctx.credentials.environment})`,
        );
      }
      try {
        const init: RequestInit = {
          method: request.method,
          signal: AbortSignal.timeout(remaining),
        };
        if (request.headers !== undefined) {
          init.headers = { ...request.headers };
        }
        if (request.body !== undefined) {
          init.body = request.body;
        }
        const response = await fetchFn(request.url, init);
        const body = await response.text();
        const headers: Record<string, string> = {};
        for (const [name, value] of response.headers) {
          headers[name] = value;
        }
        return { status: response.status, headers, body };
      } catch (error) {
        // Replay misses must fail the test loudly with "record this scenario
        // first" — never be absorbed into a timeout (CLAUDE.md rule 5).
        if (error instanceof Error && error.name === "ReplayMissError") {
          throw error;
        }
        throw new SupplierError(
          "supplier_timeout",
          `transport failure calling ${ctx.credentials.supplierCode} (${ctx.credentials.environment})`,
          { cause: error },
        );
      }
    },
  };
}
