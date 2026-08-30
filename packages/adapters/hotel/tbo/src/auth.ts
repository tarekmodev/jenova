/**
 * TBO Holidays authentication: HTTP Basic on every call, built per call from
 * the tenant's decrypted SupplierAccount secrets (docs/05-suppliers.md —
 * tenants trade on their OWN supplier accounts; nothing here is Jenova's).
 *
 * Secret keys (SupplierAccountCredentials.secrets):
 *   - `apiUrl`   — TBO HotelAPI base URL (sandbox or production)
 *   - `username` — TBO account user
 *   - `password` — TBO account password
 *
 * In development the supplier registry fills these from .env
 * (TBO_HOTEL_API_URL / TBO_HOTEL_USERNAME / TBO_HOTEL_PASSWORD); in
 * production they come from the tenant DB's SupplierAccount, decrypted at
 * call time. Values never appear in code or recordings — the sandbox-replay
 * sanitizer redacts the Authorization header before anything is committed.
 */

import { SupplierError } from "@jenova/domain";
import type { SupplierAccountCredentials } from "@jenova/supplier-sdk";

export interface TboAccount {
  /** Base URL of the TBOHolidays_HotelAPI, no trailing slash. */
  readonly apiUrl: string;
  readonly username: string;
  readonly password: string;
}

export const TBO_SECRET_KEYS = ["apiUrl", "username", "password"] as const;

/**
 * Extract and validate the TBO account from call credentials. Missing or
 * blank secrets are an auth problem (the account is not usable), surfaced
 * as SupplierError(auth_failed) before any network call.
 */
export function tboAccount(credentials: SupplierAccountCredentials): TboAccount {
  const missing = TBO_SECRET_KEYS.filter((key) => {
    const value = credentials.secrets[key];
    return value === undefined || value.trim() === "";
  });
  if (missing.length > 0) {
    throw new SupplierError(
      "auth_failed",
      `TBO credentials incomplete for tenant ${credentials.tenantId} (${credentials.environment}): missing ${missing.join(", ")}`,
    );
  }
  const apiUrl = credentials.secrets["apiUrl"] as string;
  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    username: credentials.secrets["username"] as string,
    password: credentials.secrets["password"] as string,
  };
}

/** RFC 7617 Basic credentials header value. */
export function basicAuthorization(account: TboAccount): string {
  const token = Buffer.from(`${account.username}:${account.password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}
