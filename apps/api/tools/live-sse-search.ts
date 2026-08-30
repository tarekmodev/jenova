/**
 * Live proof for the M1 search workstream (issues #59/#60/#61) —
 * development tooling only, never imported by runtime code.
 *
 * Boots the real api (gateway chain, fan-out orchestrator, pricing, signed
 * offers, availability cache) with the TBO adapter in RECORD mode, issues
 * an agency-realm session, and drives ONE live sandbox search through the
 * SSE endpoint — the sandbox-replay recorder captures the supplier traffic
 * (sanitized) for the committed recordings. A second, identical search
 * demonstrates the availability cache: it must hit Redis/cache and cost
 * ZERO additional supplier calls (look-to-book discipline, docs/05).
 *
 * Deliberate substitutions, each proven elsewhere:
 * - OFFER_STORE → in-memory port impl (the Drizzle store runs against real
 *   tenant Postgres in offer-store.integration.test.ts); OffersService
 *   signing/verification is the REAL implementation either way.
 * - Tenant directory / supplier accounts → static entries (the control
 *   plane and tenant provisioning are M0-proven; undici's fetch strips
 *   custom Host headers, so the directory accepts the loopback host).
 *
 * Credentials come from the repo-root .env (Tarek's supplier list); the
 * recorder sanitizes them out of anything that lands in recordings/.
 *
 * Run: pnpm --filter @jenova/api exec tsx tools/live-sse-search.ts
 */

import "reflect-metadata";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { tenantId, subTenantId } from "@jenova/domain";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.factory";
import { SESSION_SERVICE, type SessionService } from "../src/auth/session-service";
import { TENANT_DIRECTORY, type TenantDirectory } from "../src/gateway/tenant-directory";
import {
  InMemorySupplierAccountsSource,
  SUPPLIER_ACCOUNTS_SOURCE,
} from "../src/hotel-search/supplier-accounts";
import { InMemoryOfferStore, OFFER_STORE } from "../src/offers/offer-store";
import {
  createSupplierRegistry,
  SUPPLIER_CREDENTIALS_SOURCE,
  SUPPLIER_REGISTRY,
  type SupplierCredentialsSource,
} from "../src/supplier-registry";

const REPO_ROOT_ENV = resolve(import.meta.dirname, "../../../.env");
if (existsSync(REPO_ROOT_ENV)) {
  process.loadEnvFile(REPO_ROOT_ENV);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is not set — fill the TBO block in the repo-root .env first`);
  }
  return value;
}

const TENANT = tenantId("live-proof-tenant");
const AGENCY = subTenantId("live-proof-agency");

/** Loopback host (undici fetch owns the Host header) → the proof tenant. */
const directory: TenantDirectory = {
  resolveByHost: () => Promise.resolve({ tenantId: TENANT, dbName: "unused_in_proof" }),
};

const credentials: SupplierCredentialsSource = {
  credentialsFor: (tenant, supplierCode) =>
    Promise.resolve({
      tenantId: tenant,
      supplierCode,
      environment: "sandbox" as const,
      secrets: {
        apiUrl: requireEnv("TBO_HOTEL_API_URL"),
        username: requireEnv("TBO_HOTEL_USERNAME"),
        password: requireEnv("TBO_HOTEL_PASSWORD"),
      },
    }),
};

/**
 * Riyadh hotel codes from the recorded TBOHotelCodeList (provenance:
 * adapter recorded-scenarios.ts, captured 2026-08-30). The stay window
 * deliberately differs from the committed certification recording so this
 * session ADDS a recording instead of overwriting one CI depends on.
 */
const SEARCH_BODY = {
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
  checkIn: "2026-10-20",
  checkOut: "2026-10-21",
  rooms: [{ adults: 1, childAges: [] }],
  nationality: "SA",
  currency: "SAR",
  locale: "en",
};

interface SseFrame {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

function parseSse(text: string): SseFrame[] {
  const frames: SseFrame[] = [];
  for (const block of text.split("\n\n")) {
    const lines = block.split("\n");
    const eventLine = lines.find((line) => line.startsWith("event: "));
    const dataLine = lines.find((line) => line.startsWith("data: "));
    if (eventLine !== undefined && dataLine !== undefined) {
      frames.push({
        event: eventLine.slice(7),
        data: JSON.parse(dataLine.slice(6)) as Record<string, unknown>,
      });
    }
  }
  return frames;
}

function mask(token: unknown): string {
  const text = String(token);
  return text.length <= 16 ? "****" : `${text.slice(0, 8)}…${text.slice(-4)}`;
}

async function runSearch(baseUrl: string, token: string, label: string): Promise<void> {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/hotel-search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      accept: "text/event-stream",
    },
    body: JSON.stringify(SEARCH_BODY),
  });
  console.log(`\n=== ${label} ===`);
  console.log(`HTTP ${response.status} ${response.headers.get("content-type") ?? ""}`);
  if (!response.ok || response.body === null) {
    console.log(await response.text());
    throw new Error(`search request failed: ${response.status}`);
  }
  const text = await response.text(); // stream consumed to completion
  const elapsedMs = Date.now() - startedAt;
  for (const frame of parseSse(text)) {
    switch (frame.event) {
      case "supplier.results": {
        const offers = frame.data["offers"] as readonly Record<string, unknown>[];
        console.log(
          `supplier.results  supplier=${String(frame.data["supplierCode"])} fromCache=${String(frame.data["fromCache"])} offers=${offers.length}`,
        );
        const first = offers[0];
        if (first !== undefined) {
          const sell = first["sell"] as { amount: number; currency: string };
          console.log(
            `  e.g. ${String(first["canonicalPropertyId"])} "${String(first["supplierRoomName"])}" ` +
              `${String(first["boardBasis"])} sell=${sell.amount} ${sell.currency} (minor units) ` +
              `token=${mask(first["offerToken"])} refundable=${String(first["refundable"])}`,
          );
        }
        break;
      }
      default:
        console.log(`${frame.event}  ${JSON.stringify(frame.data)}`);
    }
  }
  console.log(`elapsed: ${elapsedMs}ms`);
}

async function main(): Promise<void> {
  const accounts = new InMemorySupplierAccountsSource();
  accounts.setEnabled(TENANT, ["tbo"]);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TENANT_DIRECTORY)
    .useValue(directory)
    .overrideProvider(SUPPLIER_ACCOUNTS_SOURCE)
    .useValue(accounts)
    .overrideProvider(SUPPLIER_CREDENTIALS_SOURCE)
    .useValue(credentials)
    .overrideProvider(OFFER_STORE)
    .useValue(new InMemoryOfferStore())
    // RECORD mode: live sandbox traffic, captured by the replay recorder.
    .overrideProvider(SUPPLIER_REGISTRY)
    .useValue(createSupplierRegistry({ mode: "record" }))
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  await app.listen(0);
  const url = await app.getUrl();
  const baseUrl = url.replace("[::1]", "127.0.0.1");

  const sessions = app.get<SessionService>(SESSION_SERVICE);
  const session = await sessions.issue({
    realm: "agency",
    userId: "live-proof-agent",
    tenantId: TENANT,
    subTenantId: AGENCY,
  });

  try {
    await runSearch(baseUrl, session.token, "search 1 — LIVE sandbox (record mode)");
    await runSearch(baseUrl, session.token, "search 2 — availability cache (expect fromCache=true)");
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
