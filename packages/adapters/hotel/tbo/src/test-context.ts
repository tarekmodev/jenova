/**
 * Test-only context builder (imported by *.test.ts, never exported from the
 * package). Replay resolves recordings by URL + body fingerprint — never by
 * credentials — so the secrets here are structural placeholders; the apiUrl
 * must match the recorded sandbox base URL for fingerprints to line up.
 * Live runs (pre-certification) overlay real credentials from the
 * environment instead — see adapter.contract.test.ts.
 */

import { tenantId } from "@jenova/domain";
import type { AdapterCallContext } from "@jenova/supplier-sdk";
import { TBO_SUPPLIER_CODE } from "./client";

/** Public base URL of the TBO sandbox HotelAPI (as recorded). */
export const TBO_SANDBOX_API_URL = "https://api.tbotechnology.in/TBOHolidays_HotelAPI";

export interface TestContextOverrides {
  readonly deadlineMs?: number;
  readonly nationality?: string;
  readonly secrets?: Readonly<Record<string, string>>;
}

export function makeTestContext(overrides: TestContextOverrides = {}): AdapterCallContext {
  return {
    credentials: {
      tenantId: tenantId("t-contract"),
      supplierCode: TBO_SUPPLIER_CODE,
      environment: "sandbox",
      secrets: overrides.secrets ?? {
        apiUrl: process.env["TBO_HOTEL_API_URL"] ?? TBO_SANDBOX_API_URL,
        username: process.env["TBO_HOTEL_USERNAME"] ?? "replay",
        password: process.env["TBO_HOTEL_PASSWORD"] ?? "replay",
      },
    },
    deadline: new Date(Date.now() + (overrides.deadlineMs ?? 40_000)),
    nationality: overrides.nationality ?? "SA",
    currency: "SAR",
    locale: "en",
  };
}
