import { describe, expect, it } from "vitest";
import type { TransportRequest } from "@jenova/supplier-sdk";
import { TboClient, TBO_ENDPOINTS } from "./client";
import { createTboTransport } from "./transport";
import { makeTestContext } from "./test-context";

describe("TboClient over replayed sandbox traffic", () => {
  it("resolves CountryList from the committed recording (real TBO response)", async () => {
    const client = new TboClient(createTboTransport({ mode: "replay" }));
    const response = await client.call(makeTestContext(), "countryList");
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body) as {
      Status: { Code: number; Description: string };
      CountryList: readonly { Code: string; Name: string }[];
    };
    expect(body.Status.Code).toBe(200);
    expect(body.CountryList.length).toBeGreaterThan(0);
    expect(body.CountryList.map((c) => c.Code)).toContain("SA");
  });

  it("fails loudly with 'record this scenario first' on an unrecorded request", async () => {
    const client = new TboClient(createTboTransport({ mode: "replay" }));
    const ctx = makeTestContext({
      secrets: {
        apiUrl: "https://api.tbotechnology.in/TBOHolidays_HotelAPI-not-recorded",
        username: "replay",
        password: "replay",
      },
    });
    await expect(client.call(ctx, "countryList")).rejects.toThrow(
      /record this scenario first/,
    );
  });

  it("attaches per-call Basic auth and JSON headers", async () => {
    const seen: TransportRequest[] = [];
    const client = new TboClient({
      send: (request) => {
        seen.push(request);
        return Promise.resolve({ status: 200, headers: {}, body: "{}" });
      },
    });
    await client.call(makeTestContext(), "cityList", { CountryCode: "SA" });
    const request = seen[0];
    expect(request?.method).toBe("POST");
    expect(request?.url.endsWith("/CityList")).toBe(true);
    expect(request?.headers?.["authorization"]).toMatch(/^Basic /);
    expect(request?.headers?.["content-type"]).toBe("application/json");
    expect(request?.idempotent).toBe(true);
  });

  it("marks booking-mutating endpoints non-idempotent at the transport level", () => {
    expect(TBO_ENDPOINTS.book.idempotent).toBe(false);
    expect(TBO_ENDPOINTS.cancel.idempotent).toBe(false);
    expect(TBO_ENDPOINTS.search.idempotent).toBe(true);
    expect(TBO_ENDPOINTS.check.idempotent).toBe(true);
    expect(TBO_ENDPOINTS.retrieve.idempotent).toBe(true);
  });
});
