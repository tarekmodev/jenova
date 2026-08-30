/**
 * Session-presence gate: any page except /login without the session cookie
 * redirects to /login. Presence only — VERIFICATION happens on every api
 * call (the cookie is an opaque revocable token only the api can judge);
 * a dead cookie's first api call 401s and the page layer redirects.
 */

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/session";

export function middleware(request: NextRequest): NextResponse {
  const hasSession = request.cookies.get(SESSION_COOKIE) !== undefined;
  const { pathname } = request.nextUrl;

  if (pathname === "/login") {
    if (hasSession) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }
  if (!hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except the BFF endpoints (they manage the session
  // themselves), Next internals and static assets.
  matcher: ["/((?!api/|_next/|favicon.ico).*)"],
};
