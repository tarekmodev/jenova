import { describe, expect, it } from "vitest";
import { SupplierError, isSupplierError, tenantId } from "@jenova/domain";
import type { AdapterCallContext } from "./contracts";
import {
  CircuitBreaker,
  createSupplierHttpClient,
  DEFAULT_RETRY_POLICY,
  UndiciTransport,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from "./transport";

// Structural plumbing only — no supplier shapes anywhere in this file.
function makeCtx(deadlineInMs = 60_000): AdapterCallContext {
  return {
    credentials: {
      tenantId: tenantId("t-structural"),
      supplierCode: "structural",
      environment: "sandbox",
      secrets: {},
    },
    deadline: new Date(Date.now() + deadlineInMs),
    nationality: "SA",
    currency: "SAR",
    locale: "en",
  };
}

const GET: TransportRequest = { method: "GET", url: "https://invalid.test/", idempotent: true };
const POST: TransportRequest = {
  method: "POST",
  url: "https://invalid.test/",
  body: "{}",
  idempotent: false,
};

/** Scripted transport: yields each entry once, in order. */
function scripted(
  script: readonly (TransportResponse | Error)[],
): Transport & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    send() {
      const step = script[calls];
      calls += 1;
      if (step === undefined) {
        throw new Error("scripted transport exhausted");
      }
      if (step instanceof Error) {
        return Promise.reject(step);
      }
      return Promise.resolve(step);
    },
  };
}

const ok: TransportResponse = { status: 200, headers: {}, body: "{}" };
const busy: TransportResponse = { status: 503, headers: {}, body: "" };

const instant = { sleep: () => Promise.resolve(), random: () => 0.5 };

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject");
}

describe("deadline budget", () => {
  it("rejects with supplier_timeout before dialing when the deadline has passed", async () => {
    const inner = scripted([ok]);
    const client = createSupplierHttpClient({ transport: inner, ...instant });
    const error = await captureError(() => client.send(GET, makeCtx(-1)));
    expect(isSupplierError(error) && error.kind).toBe("supplier_timeout");
    expect(inner.calls).toBe(0);
  });

  it("UndiciTransport rejects an already-expired deadline without any network use", async () => {
    const error = await captureError(() => new UndiciTransport().send(GET, makeCtx(-1)));
    expect(isSupplierError(error) && error.kind).toBe("supplier_timeout");
  });
});

describe("retries", () => {
  it("retries idempotent requests on retryable statuses, then returns success", async () => {
    const inner = scripted([busy, busy, ok]);
    const client = createSupplierHttpClient({ transport: inner, ...instant });
    const response = await client.send(GET, makeCtx());
    expect(response.status).toBe(200);
    expect(inner.calls).toBe(3);
  });

  it("returns the final response once attempts are exhausted", async () => {
    const inner = scripted([busy, busy, busy, busy]);
    const client = createSupplierHttpClient({ transport: inner, ...instant });
    const response = await client.send(GET, makeCtx());
    expect(response.status).toBe(503);
    expect(inner.calls).toBe(DEFAULT_RETRY_POLICY.maxAttempts);
  });

  it("retries thrown transient failures and wraps non-SupplierError causes", async () => {
    const cause = new Error("socket reset");
    const inner = scripted([cause, ok]);
    const client = createSupplierHttpClient({ transport: inner, ...instant });
    const response = await client.send(GET, makeCtx());
    expect(response.status).toBe(200);
    expect(inner.calls).toBe(2);
  });

  it("never retries non-idempotent requests", async () => {
    const inner = scripted([new Error("socket reset"), ok]);
    const client = createSupplierHttpClient({ transport: inner, ...instant });
    const error = await captureError(() => client.send(POST, makeCtx()));
    expect(isSupplierError(error) && error.kind).toBe("supplier_timeout");
    expect(inner.calls).toBe(1);
  });

  it("never retries non-transient SupplierError kinds", async () => {
    const inner = scripted([new SupplierError("auth_failed", "credentials rejected"), ok]);
    const client = createSupplierHttpClient({ transport: inner, ...instant });
    const error = await captureError(() => client.send(GET, makeCtx()));
    expect(isSupplierError(error) && error.kind).toBe("auth_failed");
    expect(inner.calls).toBe(1);
  });

  it("applies bounded full-jitter backoff between attempts", async () => {
    const delays: number[] = [];
    const inner = scripted([busy, busy, ok]);
    const client = createSupplierHttpClient({
      transport: inner,
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
      random: () => 1,
    });
    await client.send(GET, makeCtx());
    expect(delays).toEqual([
      DEFAULT_RETRY_POLICY.baseDelayMs,
      DEFAULT_RETRY_POLICY.baseDelayMs * 2,
    ]);
  });
});

describe("circuit breaker", () => {
  it("opens after consecutive failures and refuses calls without dialing", async () => {
    const clock = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1_000 }, () => clock);
    const failing = scripted([new Error("down"), new Error("down"), ok]);
    const client = createSupplierHttpClient({
      transport: failing,
      breaker,
      retry: { maxAttempts: 1 },
      ...instant,
    });

    await captureError(() => client.send(GET, makeCtx()));
    await captureError(() => client.send(GET, makeCtx()));
    expect(breaker.state).toBe("open");

    const refused = await captureError(() => client.send(GET, makeCtx()));
    expect(isSupplierError(refused) && refused.kind).toBe("supplier_timeout");
    expect(failing.calls).toBe(2);
  });

  it("half-opens after the cooldown, admits one probe, and closes on success", async () => {
    let clock = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1_000 }, () => clock);
    const inner = scripted([new Error("down"), ok, ok]);
    const client = createSupplierHttpClient({
      transport: inner,
      breaker,
      retry: { maxAttempts: 1 },
      ...instant,
    });

    await captureError(() => client.send(GET, makeCtx()));
    expect(breaker.state).toBe("open");

    clock = 1_000;
    const response = await client.send(GET, makeCtx());
    expect(response.status).toBe(200);
    expect(breaker.state).toBe("closed");
    expect(inner.calls).toBe(2);
  });

  it("re-opens when the half-open probe fails", async () => {
    let clock = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1_000 }, () => clock);
    const inner = scripted([new Error("down"), new Error("still down")]);
    const client = createSupplierHttpClient({
      transport: inner,
      breaker,
      retry: { maxAttempts: 1 },
      ...instant,
    });

    await captureError(() => client.send(GET, makeCtx()));
    clock = 1_000;
    await captureError(() => client.send(GET, makeCtx()));
    expect(breaker.state).toBe("open");
  });

  it("counts 5xx responses as failures toward opening", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1_000 });
    const inner = scripted([busy, busy, busy]);
    const client = createSupplierHttpClient({ transport: inner, breaker, ...instant });
    await client.send(GET, makeCtx());
    expect(breaker.state).toBe("open");
  });
});

describe("hooks", () => {
  it("observes each attempt (the sandbox-replay recording seam)", async () => {
    const events: string[] = [];
    const inner = scripted([busy, ok]);
    const client = createSupplierHttpClient({
      transport: inner,
      hooks: {
        onRequest: () => events.push("request"),
        onResponse: (_req, res) => events.push(`response:${res.status}`),
        onError: () => events.push("error"),
      },
      ...instant,
    });
    await client.send(GET, makeCtx());
    expect(events).toEqual(["request", "response:503", "request", "response:200"]);
  });
});
