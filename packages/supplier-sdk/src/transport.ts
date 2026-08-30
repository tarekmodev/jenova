/**
 * Shared supplier HTTP transport (docs/05-suppliers.md).
 *
 * Every adapter calls suppliers through this layer and nothing else:
 * per-call deadline abort from AdapterCallContext.deadline, bounded
 * full-jitter retries for idempotent operations only, and a per-supplier
 * circuit breaker. The `Transport` interface is the seam @jenova/sandbox-replay
 * wraps — its recorder decorates a Transport, its CI replayer replaces one —
 * so recorded and live runs differ only by injection, never by code path.
 *
 * Observability note: OTel spans per call attach via TransportHooks when the
 * api/worker apps wire their tracer (M0 ships the seam, not the otel dep).
 */

import { SupplierError, isSupplierError } from "@jenova/domain";
import { request as undiciRequest } from "undici";
import type { AdapterCallContext } from "./contracts";

export const TRANSPORT_METHODS = ["GET", "POST", "PUT", "DELETE"] as const;
export type TransportMethod = (typeof TRANSPORT_METHODS)[number];

export interface TransportRequest {
  readonly method: TransportMethod;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Pre-encoded body (codecs produce it); omitted for bodiless methods. */
  readonly body?: string;
  /**
   * Whether this call is safe to retry at the transport level. Booking
   * calls are NOT transport-idempotent — their retry safety comes from the
   * clientReference the adapter passes through, decided above this layer.
   */
  readonly idempotent: boolean;
}

export interface TransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * The seam every adapter call flows through. Implementations: the default
 * UndiciTransport (live), sandbox-replay's recorder (wraps one of these)
 * and replayer (replaces it). Adapters never open sockets themselves.
 */
export interface Transport {
  send(request: TransportRequest, ctx: AdapterCallContext): Promise<TransportResponse>;
}

/** Observation points (recording, OTel spans, logging). Called per attempt. */
export interface TransportHooks {
  onRequest?(request: TransportRequest, ctx: AdapterCallContext): void;
  onResponse?(
    request: TransportRequest,
    response: TransportResponse,
    ctx: AdapterCallContext,
  ): void;
  onError?(request: TransportRequest, error: unknown, ctx: AdapterCallContext): void;
}

function remainingMs(ctx: AdapterCallContext, now: () => number): number {
  return ctx.deadline.getTime() - now();
}

function deadlineExceeded(ctx: AdapterCallContext): SupplierError {
  return new SupplierError(
    "supplier_timeout",
    `deadline exhausted calling ${ctx.credentials.supplierCode} (${ctx.credentials.environment})`,
  );
}

/** Default live transport: undici with an AbortSignal cut from the context deadline. */
export class UndiciTransport implements Transport {
  async send(request: TransportRequest, ctx: AdapterCallContext): Promise<TransportResponse> {
    const remaining = remainingMs(ctx, Date.now);
    if (remaining <= 0) {
      throw deadlineExceeded(ctx);
    }
    try {
      const options: Parameters<typeof undiciRequest>[1] = {
        method: request.method,
        signal: AbortSignal.timeout(remaining),
      };
      if (request.headers !== undefined) {
        options.headers = { ...request.headers };
      }
      if (request.body !== undefined) {
        options.body = request.body;
      }
      const response = await undiciRequest(request.url, options);
      const body = await response.body.text();
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(response.headers)) {
        headers[name] = Array.isArray(value) ? value.join(", ") : String(value ?? "");
      }
      return { status: response.statusCode, headers, body };
    } catch (error) {
      // Transport-level failures (abort at deadline, DNS, reset) all read as
      // "the supplier did not answer in time" to the engine.
      throw new SupplierError(
        "supplier_timeout",
        `transport failure calling ${ctx.credentials.supplierCode} (${ctx.credentials.environment})`,
        { cause: error },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Retry policy — bounded, full jitter, idempotent operations only
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  /** Total attempts including the first. Non-idempotent requests always get 1. */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Response statuses worth retrying (throttling and upstream hiccups). */
  readonly retryableStatuses: readonly number[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 2_000,
  retryableStatuses: [429, 502, 503, 504],
};

/** Only transient kinds are retryable; auth/validation failures never are. */
const RETRYABLE_ERROR_KINDS = new Set(["supplier_timeout", "rate_limited"]);

// ---------------------------------------------------------------------------
// Circuit breaker — per supplier account, consecutive-failure trip
// ---------------------------------------------------------------------------

export interface CircuitBreakerOptions {
  /** Consecutive failures that open the circuit. */
  readonly failureThreshold: number;
  /** How long the circuit stays open before a single half-open probe. */
  readonly cooldownMs: number;
}

export const DEFAULT_CIRCUIT_BREAKER_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  cooldownMs: 30_000,
};

export type CircuitBreakerState = "closed" | "open" | "half_open";

/**
 * One breaker per supplier account (the engine holds one per
 * supplierCode+environment and shares it across that supplier's clients).
 * closed → open after N consecutive failures; open → half_open after the
 * cooldown, admitting exactly one probe; probe success closes, failure
 * re-opens.
 */
export class CircuitBreaker {
  readonly #options: CircuitBreakerOptions;
  readonly #now: () => number;
  #state: CircuitBreakerState = "closed";
  #consecutiveFailures = 0;
  #openedAt = 0;
  #probeInFlight = false;

  constructor(options: Partial<CircuitBreakerOptions> = {}, now: () => number = Date.now) {
    this.#options = { ...DEFAULT_CIRCUIT_BREAKER_OPTIONS, ...options };
    this.#now = now;
  }

  get state(): CircuitBreakerState {
    return this.#state;
  }

  /** Throws SupplierError(supplier_timeout) while the circuit refuses calls. */
  assertCanCall(supplierCode: string): void {
    if (this.#state === "open") {
      if (this.#now() - this.#openedAt >= this.#options.cooldownMs) {
        this.#state = "half_open";
        this.#probeInFlight = false;
      } else {
        throw new SupplierError(
          "supplier_timeout",
          `circuit open for ${supplierCode}: supplier failing, retry after cooldown`,
        );
      }
    }
    if (this.#state === "half_open") {
      if (this.#probeInFlight) {
        throw new SupplierError(
          "supplier_timeout",
          `circuit half-open for ${supplierCode}: probe already in flight`,
        );
      }
      this.#probeInFlight = true;
    }
  }

  recordSuccess(): void {
    this.#state = "closed";
    this.#consecutiveFailures = 0;
    this.#probeInFlight = false;
  }

  recordFailure(): void {
    if (this.#state === "half_open") {
      this.#trip();
      return;
    }
    this.#consecutiveFailures += 1;
    if (this.#consecutiveFailures >= this.#options.failureThreshold) {
      this.#trip();
    }
  }

  /**
   * An outcome that proves nothing about supplier health — e.g. a
   * sandbox-replay miss in CI, where no supplier was ever dialed. Releases a
   * half-open probe slot (so the breaker cannot wedge waiting on a probe
   * that never reached a supplier) but leaves the state and the
   * consecutive-failure count untouched in every direction: it neither
   * counts toward opening, nor resets the count, nor restarts the cooldown.
   */
  recordInconclusive(): void {
    this.#probeInFlight = false;
  }

  #trip(): void {
    this.#state = "open";
    this.#openedAt = this.#now();
    this.#consecutiveFailures = 0;
    this.#probeInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Client — deadline + retries + breaker composed over an injected Transport
// ---------------------------------------------------------------------------

export interface SupplierHttpClientOptions {
  /** The inner seam. Defaults to UndiciTransport; sandbox-replay injects here. */
  readonly transport?: Transport;
  readonly retry?: Partial<RetryPolicy>;
  /** Share one breaker per supplier account across clients. */
  readonly breaker?: CircuitBreaker;
  readonly hooks?: TransportHooks;
  /** Test seams — production uses the defaults. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Matched by name, not instanceof — @jenova/supplier-sdk deliberately does
 * not depend on @jenova/sandbox-replay (the replayer wraps this layer from
 * the outside; docs/09-testing.md).
 */
function isReplayMiss(error: unknown): boolean {
  return error instanceof Error && error.name === "ReplayMissError";
}

/**
 * The client every adapter uses. It is itself a Transport, so composition
 * (recorder around client, or client around replayer) stays uniform.
 */
export function createSupplierHttpClient(options: SupplierHttpClientOptions = {}): Transport {
  const transport = options.transport ?? new UndiciTransport();
  const retry: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retry };
  const breaker = options.breaker ?? new CircuitBreaker();
  const hooks = options.hooks ?? {};
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  async function attemptOnce(
    request: TransportRequest,
    ctx: AdapterCallContext,
  ): Promise<TransportResponse> {
    hooks.onRequest?.(request, ctx);
    try {
      const response = await transport.send(request, ctx);
      hooks.onResponse?.(request, response, ctx);
      return response;
    } catch (error) {
      hooks.onError?.(request, error, ctx);
      if (isSupplierError(error)) {
        throw error;
      }
      // sandbox-replay's cache miss must stay loud ("record this scenario
      // first") — wrapping it as a timeout would let CI mistake a missing
      // recording for supplier flakiness (docs/09-testing.md).
      if (isReplayMiss(error)) {
        throw error;
      }
      throw new SupplierError(
        "supplier_timeout",
        `transport failure calling ${ctx.credentials.supplierCode} (${ctx.credentials.environment})`,
        { cause: error },
      );
    }
  }

  function backoffDelay(attempt: number): number {
    const ceiling = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** (attempt - 1));
    return Math.floor(random() * ceiling);
  }

  return {
    async send(request, ctx) {
      breaker.assertCanCall(ctx.credentials.supplierCode);
      const maxAttempts = request.idempotent ? retry.maxAttempts : 1;
      let result: TransportResponse;
      try {
        result = await (async () => {
          for (let attempt = 1; ; attempt += 1) {
            if (remainingMs(ctx, now) <= 0) {
              throw deadlineExceeded(ctx);
            }
            let response: TransportResponse;
            try {
              response = await attemptOnce(request, ctx);
            } catch (error) {
              const retryable =
                isSupplierError(error) && RETRYABLE_ERROR_KINDS.has(error.kind);
              if (!retryable || attempt >= maxAttempts) {
                throw error;
              }
              const delay = backoffDelay(attempt);
              if (remainingMs(ctx, now) <= delay) {
                throw error;
              }
              await sleep(delay);
              continue;
            }
            if (
              retry.retryableStatuses.includes(response.status) &&
              attempt < maxAttempts
            ) {
              const delay = backoffDelay(attempt);
              if (remainingMs(ctx, now) <= delay) {
                return response;
              }
              await sleep(delay);
              continue;
            }
            return response;
          }
        })();
      } catch (error) {
        // A replay miss means no supplier was dialed at all: it must surface
        // as "record this scenario first", never accumulate into a
        // misleading "circuit open" (review #74 L3).
        if (isReplayMiss(error)) {
          breaker.recordInconclusive();
        } else {
          breaker.recordFailure();
        }
        throw error;
      }
      if (result.status >= 500) {
        breaker.recordFailure();
      } else {
        breaker.recordSuccess();
      }
      return result;
    },
  };
}
