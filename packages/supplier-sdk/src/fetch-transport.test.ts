import { describe, expect, it } from "vitest";
import { isSupplierError, tenantId } from "@jenova/domain";
import type { AdapterCallContext } from "./contracts";
import { createFetchTransport, type FetchFn } from "./fetch-transport";
import type { TransportRequest } from "./transport";

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

const POST: TransportRequest = {
  method: "POST",
  url: "https://invalid.test/endpoint",
  headers: { "content-type": "application/json" },
  body: "{}",
  idempotent: false,
};

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject");
}

describe("createFetchTransport", () => {
  it("passes method/headers/body through and returns status, headers, body", async () => {
    let seenUrl: string | URL | undefined;
    let seenInit: RequestInit | undefined;
    const fetchFn: FetchFn = (url, init) => {
      seenUrl = url;
      seenInit = init;
      return Promise.resolve(
        new Response("pong", { status: 201, headers: { "x-probe": "yes" } }),
      );
    };
    const transport = createFetchTransport(fetchFn);
    const response = await transport.send(POST, makeCtx());
    expect(seenUrl).toBe(POST.url);
    expect(seenInit?.method).toBe("POST");
    expect(seenInit?.body).toBe("{}");
    expect(new Headers(seenInit?.headers).get("content-type")).toBe("application/json");
    expect(response.status).toBe(201);
    expect(response.headers["x-probe"]).toBe("yes");
    expect(response.body).toBe("pong");
  });

  it("rejects with supplier_timeout before dialing when the deadline has passed", async () => {
    const transport = createFetchTransport(() => {
      throw new Error("must not dial");
    });
    const error = await captureError(() => transport.send(POST, makeCtx(-1)));
    expect(isSupplierError(error) && error.kind).toBe("supplier_timeout");
  });

  it("cuts the abort signal from the remaining deadline budget", async () => {
    let signal: AbortSignal | undefined;
    const transport = createFetchTransport((_url, init) => {
      signal = init?.signal ?? undefined;
      return Promise.resolve(new Response(""));
    });
    await transport.send(POST, makeCtx(5_000));
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it("maps fetch failures to supplier_timeout with the cause attached", async () => {
    const boom = new Error("connection reset");
    const transport = createFetchTransport(() => Promise.reject(boom));
    const error = await captureError(() => transport.send(POST, makeCtx()));
    expect(isSupplierError(error) && error.kind).toBe("supplier_timeout");
    expect(isSupplierError(error) && error.cause).toBe(boom);
  });

  it("lets a ReplayMissError through untouched — a miss must fail loudly", async () => {
    const miss = new Error("record this scenario first: abc123 (supplier structural)");
    miss.name = "ReplayMissError";
    const transport = createFetchTransport(() => Promise.reject(miss));
    const error = await captureError(() => transport.send(POST, makeCtx()));
    expect(error).toBe(miss);
  });
});
