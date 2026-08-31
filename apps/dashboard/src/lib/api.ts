/**
 * Server-side api client (BFF half of the dashboard).
 *
 * Apps call services, never tables (CLAUDE.md rule 2): every read and
 * write goes to apps/api over HTTP with the session cookie translated to
 * the realm-tagged bearer the gateway expects. Tenant resolution is by
 * Host header — JENOVA_TENANT_HOST pins it explicitly (e2e, single-tenant
 * dev); otherwise the dashboard's own incoming host is presented, so one
 * dashboard deployment serves any tenant whose host is bound in the
 * control plane.
 *
 * Server-only: importing this from a client component fails the build.
 */

import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "./session";

export const API_URL = process.env["JENOVA_API_URL"] ?? "http://localhost:3000";

export interface ApiErrorEnvelope {
  readonly error: { readonly code: string; readonly message: string; readonly requestId: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function tenantHost(): Promise<string> {
  const pinned = process.env["JENOVA_TENANT_HOST"];
  if (pinned !== undefined && pinned !== "") return pinned;
  return (await headers()).get("host") ?? "";
}

/**
 * Raw fetch to the api with tenant host + session bearer attached. The
 * tenant host travels as X-Forwarded-Host (undici's fetch refuses to
 * override Host; the gateway prefers the forwarded header — we ARE the
 * proxy).
 */
export async function apiFetch(
  path: string,
  init: RequestInit & { readonly anonymous?: boolean } = {},
): Promise<Response> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const requestHeaders = new Headers(init.headers);
  requestHeaders.set("x-forwarded-host", await tenantHost());
  // `anonymous` keeps a stale cookie off anonymous routes (login): the
  // gateway refuses present-but-invalid credentials even under
  // @AllowAnonymous — deliberately, so we must not offer one.
  if (init.anonymous !== true && token !== undefined && !requestHeaders.has("authorization")) {
    requestHeaders.set("authorization", `Bearer ${token}`);
  }
  if (init.body !== undefined && !requestHeaders.has("content-type")) {
    requestHeaders.set("content-type", "application/json");
  }
  return fetch(`${API_URL}${path}`, { ...init, headers: requestHeaders, cache: "no-store" });
}

async function errorFrom(response: Response): Promise<ApiError> {
  let code = "internal_error";
  let message = "request failed";
  try {
    const body = (await response.json()) as ApiErrorEnvelope;
    code = body.error.code;
    message = body.error.message;
  } catch {
    // Non-JSON failure body — keep the generic envelope.
  }
  return new ApiError(response.status, code, message);
}

/** JSON call for route handlers/actions — failures become typed ApiError. */
export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    throw await errorFrom(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/**
 * JSON call for PAGES: a dead/missing session redirects to /login instead
 * of rendering an error — the one place the dashboard interprets a 401.
 */
export async function apiJsonOrLogin<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await apiJson<T>(path, init);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect("/login");
    }
    throw error;
  }
}
