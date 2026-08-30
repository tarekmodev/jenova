/**
 * Recording-session environment (development tooling only — never imported
 * by runtime code). Builds the AdapterCallContext for deliberate live
 * sandbox sessions from the repo-root .env (TBO_HOTEL_API_URL /
 * TBO_HOTEL_USERNAME / TBO_HOTEL_PASSWORD). Secrets stay in .env; the
 * sandbox-replay sanitizer strips them from anything that lands in
 * recordings/ (CLAUDE.md rule 5 + secrets policy).
 */

import { fileURLToPath } from "node:url";
import { tenantId } from "@jenova/domain";
import type { AdapterCallContext } from "@jenova/supplier-sdk";
import { TBO_SUPPLIER_CODE } from "../src/index";

const REPO_ROOT_ENV = fileURLToPath(new URL("../../../../../.env", import.meta.url));

export function loadRepoEnv(): void {
  try {
    process.loadEnvFile(REPO_ROOT_ENV);
  } catch {
    // .env may be absent when the variables come from the shell instead.
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is not set — fill the TBO block in the repo-root .env first`);
  }
  return value;
}

export interface RecordingContextOverrides {
  readonly deadlineMs?: number;
  readonly nationality?: string;
  /** Substitute secret material (e.g. the auth_failed scenario's scratch password). */
  readonly password?: string;
}

/** A deliberate, budgeted live-session context. Default deadline: 35s (TBO search budget). */
export function recordingContext(overrides: RecordingContextOverrides = {}): AdapterCallContext {
  return {
    credentials: {
      tenantId: tenantId("dev-recording-session"),
      supplierCode: TBO_SUPPLIER_CODE,
      environment: "sandbox",
      secrets: {
        apiUrl: requireEnv("TBO_HOTEL_API_URL"),
        username: requireEnv("TBO_HOTEL_USERNAME"),
        password: overrides.password ?? requireEnv("TBO_HOTEL_PASSWORD"),
      },
    },
    deadline: new Date(Date.now() + (overrides.deadlineMs ?? 35_000)),
    nationality: overrides.nationality ?? "SA",
    currency: "SAR",
    locale: "en",
  };
}
