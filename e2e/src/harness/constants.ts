/**
 * Shared harness constants (config + setup + specs import these).
 *
 * The RECORDED_* values are OUR OWN request data from the committed TBO
 * certification lifecycle (packages/sandbox-replay/recordings/tbo, booking
 * LVFXI5 — booked and cancelled on the real sandbox on 2026-08-30). They
 * MUST byte-match the recorded Book request, and e2e may not import adapter
 * packages (ESLint boundary), so they are duplicated here verbatim — the
 * same convention as apps/api's booking integration suite. Replay fails
 * loudly on drift.
 */

export const API_PORT = 43117;
export const PORTAL_PORT = 43118;

/** Per-project tenant hosts — one tenant per locale run. */
export const TENANT_HOSTS = { ar: "localhost", en: "127.0.0.1" } as const;

/** Seeded portal login (structural test credentials, per-run database). */
export const AGENT_EMAIL = "agent@e2e.jenova.example";
export const AGENT_PASSWORD = "jenova-e2e-agent-password";
export const AGENCY_NAME = "E2E Agency";

// --- Recorded lifecycle request data (duplicated verbatim, see above) -------
export const RECORDED_CHECK_IN = "2026-10-13";
export const RECORDED_CHECK_OUT = "2026-10-14";
export const RECORDED_NATIONALITY = "SA";
export const RECORDED_CITY_NAME = "Riyadh";
/** The recorded lifecycle rate (hotel 1065918 "Comfort Inn Taawn"). */
export const RECORDED_ROOM_NAME = "Studio,2 Twin Beds";
export const RECORDED_CLIENT_REFERENCE = "JENOVA-M1-TBO-CERT-0001";
export const RECORDED_CONFIRMATION_NUMBER = "LVFXI5";
export const RECORDED_HOLDER = {
  firstName: "Jenova",
  lastName: "Certification",
  email: "jenova.certification@example.com",
  phone: "966555000000",
} as const;
export const RECORDED_GUEST = { firstName: "Jenova", lastName: "Certification" } as const;

/** docs/apps/b2b.md acceptance heuristic: search → book under 90 seconds. */
export const SEARCH_TO_BOOK_BUDGET_MS = 90_000;
