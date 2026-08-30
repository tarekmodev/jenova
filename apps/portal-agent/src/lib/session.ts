/**
 * Server-side session/locale helpers (App Router). The agency bearer token
 * lives ONLY in an httpOnly cookie — client code never sees it; the proxy
 * route attaches it to upstream api calls.
 */

import { cookies, headers } from "next/headers";
import type { Locale } from "@jenova/domain";
import { isLocale } from "@jenova/domain";
import { apiJson } from "./api-server";
import type { SessionContext } from "./types";

export const SESSION_COOKIE = "jenova_agent_session";
export const LOCALE_COOKIE = "jenova_agent_locale";

/** Arabic first (CLAUDE.md rule 9): no cookie means Arabic. */
export async function resolveLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value ?? "";
  return isLocale(value) ? value : "ar";
}

export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/** The Host the browser addressed — forwarded for api tenant resolution. */
export async function tenantHost(): Promise<string> {
  return (await headers()).get("host") ?? "";
}

/**
 * Validates the session against the api and returns its context (user,
 * agency defaults, tenant branding); null = not logged in / expired.
 */
export async function fetchSessionContext(): Promise<SessionContext | null> {
  const token = await sessionToken();
  if (token === null) {
    return null;
  }
  const { status, json } = await apiJson({
    method: "GET",
    path: "/auth/agency/session",
    tenantHost: await tenantHost(),
    headers: { authorization: `Bearer ${token}` },
  });
  if (status !== 200 || json === null) {
    return null;
  }
  return json as SessionContext;
}
