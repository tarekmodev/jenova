/**
 * Session BFF: translates the api's realm-tagged bearer into an httpOnly
 * cookie the browser can hold. The token itself never reaches page script.
 *
 * POST   — login (email + password [+ totpCode]) → sets the cookie.
 * DELETE — logout → revokes the session at the api, clears the cookie.
 */

import { NextResponse, type NextRequest } from "next/server";
import { apiFetch } from "../../../lib/api";
import { SESSION_COOKIE } from "../../../lib/session";

interface LoginSuccess {
  readonly token: string;
  readonly expiresAt: string;
  readonly user: Record<string, unknown>;
  readonly totpEnrollmentRequired: boolean;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  const upstream = await apiFetch("/staff/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
    anonymous: true,
  });

  if (!upstream.ok) {
    // Pass the api's envelope through untouched (401 unauthorized /
    // totp_required / totp_invalid) — the login form localizes by code.
    const envelope: unknown = await upstream.json().catch(() => ({
      error: { code: "internal_error", message: "login failed", requestId: "" },
    }));
    return NextResponse.json(envelope, { status: upstream.status });
  }

  const login = (await upstream.json()) as LoginSuccess;
  const response = NextResponse.json({
    user: login.user,
    totpEnrollmentRequired: login.totpEnrollmentRequired,
  });
  response.cookies.set(SESSION_COOKIE, login.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(login.expiresAt),
  });
  return response;
}

export async function DELETE(): Promise<NextResponse> {
  // Best effort at the api (an already-dead session is fine) — the cookie
  // is cleared regardless, so the browser is logged out either way.
  await apiFetch("/staff/auth/logout", { method: "POST" }).catch(() => undefined);
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
