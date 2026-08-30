/** Logout bridge: revoke the api session, then drop the cookie. */

import { NextResponse, type NextRequest } from "next/server";
import { apiJson } from "../../../lib/api-server";
import { SESSION_COOKIE } from "../../../lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const token = request.cookies.get(SESSION_COOKIE)?.value ?? null;
  if (token !== null) {
    // Best-effort server-side revocation; the cookie dies regardless.
    await apiJson({
      method: "POST",
      path: "/auth/agency/logout",
      tenantHost: request.headers.get("host") ?? "",
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
