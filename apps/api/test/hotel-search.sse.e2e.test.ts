/**
 * Replay-backed SSE integration (issues #59/#60): a REAL search request
 * travels the full stack — gateway chain (tenant resolution → agency-realm
 * session auth) → fan-out orchestrator → TBO adapter in REPLAY mode →
 * pricing → signed offer issuance → text/event-stream frames.
 *
 * Supplier traffic is the committed live-sandbox recording (CLAUDE.md
 * rule 5): the Riyadh search captured 2026-08-30 (see
 * packages/adapters/hotel/tbo/src/recorded-scenarios.ts). The query below
 * repeats that recording's OWN request inputs verbatim — our request data,
 * not fabricated supplier data; replay fails loudly on any drift.
 */

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { subTenantId, tenantId, type TenantId } from "@jenova/domain";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.factory";
import { SESSION_SERVICE, type SessionService } from "../src/auth/session-service";
import { API_CONFIG, type ApiConfig } from "../src/config/config";
import { REQUEST_ID_HEADER } from "../src/gateway/request-context.middleware";
import { TENANT_DIRECTORY, type TenantDirectory } from "../src/gateway/tenant-directory";
import { InMemorySupplierAccountsSource, SUPPLIER_ACCOUNTS_SOURCE } from "../src/hotel-search/supplier-accounts";
import { InMemoryOfferStore, OFFER_STORE } from "../src/offers/offer-store";
import { OFFERS_SERVICE, type OffersService } from "../src/offers/offers.service";
import {
  createSupplierRegistry,
  SUPPLIER_CREDENTIALS_SOURCE,
  SUPPLIER_REGISTRY,
  type SupplierCredentialsSource,
} from "../src/supplier-registry";

// Structural config — mirrors .env.example's local defaults (chain shape only).
const testConfig: ApiConfig = Object.freeze({
  nodeEnv: "test",
  port: 0,
  controlPlaneDatabaseUrl: "postgres://jenova:jenova@localhost:5432/jenova_control_plane",
  redisUrl: "redis://localhost:6379",
  tenantRuntimeDsn: "postgres://jenova_app:jenova_app@localhost:5432/postgres",
  offerSigningKey: "dev-only-offer-signing-key-change-me-0000",
  hotelSearchBudgetMs: 8_000,
});

const KNOWN_HOST = "tenant-one.example.test";
const KNOWN_TENANT: TenantId = tenantId("tenant-one");
const AGENCY = subTenantId("agency-1");

const testDirectory: TenantDirectory = {
  resolveByHost: (host) =>
    Promise.resolve(
      host === KNOWN_HOST ? { tenantId: KNOWN_TENANT, dbName: "tenant_one_db" } : null,
    ),
};

/**
 * Replay resolves recordings by URL + body fingerprint, never by credential
 * values — these secrets are structural placeholders; the apiUrl must match
 * the recorded sandbox base URL for fingerprints to line up.
 */
const replayCredentials: SupplierCredentialsSource = {
  credentialsFor: (tenant, supplierCode) =>
    Promise.resolve({
      tenantId: tenant,
      supplierCode,
      environment: "sandbox",
      secrets: {
        apiUrl: "https://api.tbotechnology.in/TBOHolidays_HotelAPI",
        username: "replay",
        password: "replay",
      },
    }),
};

/**
 * The recorded search's own request inputs (recorded-scenarios.ts
 * provenance: TBOHotelCodeList for Riyadh, stay 2026-10-13 → 2026-10-14,
 * 1 adult, SA nationality — captured live 2026-08-30).
 */
const RECORDED_SEARCH_BODY = {
  target: {
    kind: "properties",
    canonicalPropertyIds: [
      "tbo:1010062",
      "tbo:1032860",
      "tbo:1037420",
      "tbo:1065918",
      "tbo:1065929",
      "tbo:1065933",
      "tbo:1065937",
      "tbo:1065954",
      "tbo:1077182",
      "tbo:1087447",
    ],
  },
  checkIn: "2026-10-13",
  checkOut: "2026-10-14",
  rooms: [{ adults: 1, childAges: [] }],
  nationality: "SA",
  currency: "SAR",
  locale: "en",
} as const;

interface SseFrame {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

/** Minimal SSE parser: named events with single-line JSON data. */
function parseSse(text: string): SseFrame[] {
  const frames: SseFrame[] = [];
  for (const block of text.split("\n\n")) {
    const lines = block.split("\n").filter((line) => line.length > 0);
    const eventLine = lines.find((line) => line.startsWith("event: "));
    const dataLine = lines.find((line) => line.startsWith("data: "));
    if (eventLine !== undefined && dataLine !== undefined) {
      frames.push({
        event: eventLine.slice("event: ".length),
        data: JSON.parse(dataLine.slice("data: ".length)) as Record<string, unknown>,
      });
    }
  }
  return frames;
}

/** supertest parser that buffers the streamed SSE body as text. */
function collectText(res: request.Response, callback: (err: Error | null, body: string) => void): void {
  let body = "";
  res.setEncoding("utf8");
  res.on("data", (chunk: string) => {
    body += chunk;
  });
  res.on("end", () => callback(null, body));
}

describe("hotel search SSE e2e (replay-backed)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const accounts = new InMemorySupplierAccountsSource();
    accounts.setEnabled(KNOWN_TENANT, ["tbo"]);

    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_CONFIG)
      .useValue(testConfig)
      .overrideProvider(TENANT_DIRECTORY)
      .useValue(testDirectory)
      .overrideProvider(SUPPLIER_ACCOUNTS_SOURCE)
      .useValue(accounts)
      .overrideProvider(SUPPLIER_CREDENTIALS_SOURCE)
      .useValue(replayCredentials)
      // The Drizzle offer store is proven against real tenant Postgres in
      // its own integration suite; here it would demand a provisioned DB,
      // so the in-memory port implementation stands in.
      .overrideProvider(OFFER_STORE)
      .useValue(new InMemoryOfferStore())
      // Adapter transport pinned to replay — recordings only, no network.
      .overrideProvider(SUPPLIER_REGISTRY)
      .useValue(createSupplierRegistry({ mode: "replay" }))
      .compile();
    app = testingModule.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function agencyToken(): Promise<string> {
    const sessions = app.get<SessionService>(SESSION_SERVICE);
    const issued = await sessions.issue({
      realm: "agency",
      userId: "agent-1",
      tenantId: KNOWN_TENANT,
      subTenantId: AGENCY,
    });
    return issued.token;
  }

  it("streams a full recorded TBO search end to end with signed offers", async () => {
    const token = await agencyToken();
    const res = await request(app.getHttpServer())
      .post("/hotel-search")
      .set("Host", KNOWN_HOST)
      .set("Authorization", `Bearer ${token}`)
      .send(RECORDED_SEARCH_BODY)
      .buffer(true)
      .parse(collectText)
      .expect(200);

    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["cache-control"]).toContain("no-transform");
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(/[0-9a-f-]{36}/);

    const body = res.body as unknown as string;
    expect(body.startsWith(": connected")).toBe(true);
    const frames = parseSse(body);
    expect(frames.map((f) => f.event)).toEqual([
      "search.started",
      "supplier.results",
      "search.completed",
    ]);

    const started = frames[0]?.data;
    expect(started?.["supplierCodes"]).toEqual(["tbo"]);

    const results = frames[1]?.data;
    expect(results?.["supplierCode"]).toBe("tbo");
    const offers = results?.["offers"] as readonly Record<string, unknown>[];
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      expect(String(offer["offerToken"]).startsWith("of1.")).toBe(true);
      expect(String(offer["canonicalPropertyId"]).startsWith("tbo:")).toBe(true);
      const sell = offer["sell"] as { amount: number; currency: string };
      expect(Number.isSafeInteger(sell.amount)).toBe(true);
      expect(sell.amount).toBeGreaterThan(0);
      expect(sell.currency).toMatch(/^[A-Z]{3}$/);
    }

    const completed = frames[2]?.data;
    expect(completed).toMatchObject({
      status: "complete",
      suppliersQueried: 1,
      suppliersSucceeded: 1,
      suppliersFailed: 0,
      offerCount: offers.length,
    });

    // The streamed token verifies end to end for the issuing agency scope —
    // signed, server-priced, nationality pinned (rules 8/9).
    const offersService = app.get<OffersService>(OFFERS_SERVICE);
    const first = offers[0];
    if (first === undefined) throw new Error("no offers streamed");
    const verified = await offersService.verifyOfferToken(
      KNOWN_TENANT,
      String(first["offerToken"]),
      { subTenantId: AGENCY },
    );
    expect(verified.nationality).toBe("SA");
    expect(verified.supplierCode).toBe("tbo");
    expect(verified.sell.amount).toBe((first["sell"] as { amount: number }).amount);
  });

  it("refuses anonymous and cross-realm callers with the standard envelope (chain intact)", async () => {
    await request(app.getHttpServer())
      .post("/hotel-search")
      .set("Host", KNOWN_HOST)
      .send(RECORDED_SEARCH_BODY)
      .expect(401)
      .expect("Content-Type", /json/);

    const sessions = app.get<SessionService>(SESSION_SERVICE);
    const consumer = await sessions.issue({
      realm: "consumer",
      userId: "shopper-1",
      tenantId: KNOWN_TENANT,
      subTenantId: null,
    });
    await request(app.getHttpServer())
      .post("/hotel-search")
      .set("Host", KNOWN_HOST)
      .set("Authorization", `Bearer ${consumer.token}`)
      .send(RECORDED_SEARCH_BODY)
      .expect(401);
  });

  it("refuses a malformed body with a JSON envelope BEFORE any stream opens", async () => {
    const token = await agencyToken();
    const res = await request(app.getHttpServer())
      .post("/hotel-search")
      .set("Host", KNOWN_HOST)
      .set("Authorization", `Bearer ${token}`)
      .send({ ...RECORDED_SEARCH_BODY, nationality: "saudi" })
      .expect(400)
      .expect("Content-Type", /json/);
    expect((res.body as { error: { code: string } }).error.code).toBe("bad_request");
  });
});
