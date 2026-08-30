/**
 * Locale switch: stores the user's display-language preference in a
 * cookie; every request re-reads it (i18n/request.ts) and the root layout
 * re-stamps <html dir lang>. Storage stays Gregorian UTC everywhere —
 * locale is a display concern (CLAUDE.md rule 9).
 */

import { NextResponse, type NextRequest } from "next/server";
import { isLocale } from "@jenova/domain";
import { LOCALE_COOKIE } from "../../../lib/session";

const ONE_YEAR_S = 365 * 24 * 60 * 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  const locale =
    typeof body === "object" && body !== null && "locale" in body
      ? (body as { locale: unknown }).locale
      : null;
  if (typeof locale !== "string" || !isLocale(locale)) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "locale must be ar or en", requestId: "" } },
      { status: 400 },
    );
  }
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(LOCALE_COOKIE, locale, {
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_S,
  });
  return response;
}
