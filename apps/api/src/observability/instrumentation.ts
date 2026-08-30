/**
 * OTel instrumentation hook point (issue #30).
 *
 * M0 ships the SEAM, not the otel dependency — the same decision as
 * @jenova/supplier-sdk's TransportHooks. When observability is wired
 * (docs/07-tech-stack.md: OpenTelemetry → Grafana Cloud/SigNoz), the tracer
 * binds an implementation of this interface to HTTP_SERVER_HOOKS; nothing in
 * the api imports otel packages until then.
 *
 * The gateway's request-context middleware invokes these hooks once per
 * request, after the request id exists.
 */

export interface HttpRequestStart {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
}

export interface HttpRequestEnd extends HttpRequestStart {
  readonly statusCode: number;
  readonly durationMs: number;
}

export interface HttpServerHooks {
  onRequest?(info: HttpRequestStart): void;
  onResponse?(info: HttpRequestEnd): void;
}

/** Nest injection token for the process-wide {@link HttpServerHooks}. */
export const HTTP_SERVER_HOOKS = Symbol("jenova.api.httpServerHooks");

export const noopHttpServerHooks: HttpServerHooks = Object.freeze({});
