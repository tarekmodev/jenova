/**
 * Login bridge: calls the api's agency login and moves the bearer token into
 * an httpOnly cookie. The token NEVER reaches client JavaScript — the
 * browser gets only the session context (user/agency/tenant).
 */

import { NextResponse, type NextRequest } from "next/server";
import { apiJson } from "../../../lib/api-server";
import { SESSION_COOKIE } from "../../../lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "bad_request" } }, { status: 400 });
  }

  const { status, json } = await apiJson({
    method: "POST",
    path: "/auth/agency/login",
    tenantHost: request.headers.get("host") ?? "",
    body: JSON.stringify(body),
  });

  if (status !== 200 || typeof json !== "object" || json === null) {
    return NextResponse.json(json ?? { error: { code: "unauthorized" } }, { status });
  }

  const { token, expiresAt, ...context } = json as {
    token: string;
    expiresAt: string;
    [key: string]: unknown;
  };
  const response = NextResponse.json(context);
  const maxAgeSeconds = Math.max(60, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
    // Secure outside an EXPLICIT development env — same fail-closed posture
    // as the engine's resolveNodeEnv (unset/typo'd NODE_ENV = production).
    // Browsers still accept Secure cookies on localhost/loopback, so local
    // production builds (and the e2e harness) keep working over http.
    secure: process.env.NODE_ENV !== "development",
  });
  return response;
}
