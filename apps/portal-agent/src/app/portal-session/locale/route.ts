/** Locale switch: persists the display locale (Arabic is the default). */

import { NextResponse, type NextRequest } from "next/server";
import { isLocale } from "@jenova/domain";
import { LOCALE_COOKIE } from "../../../lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  let locale = "";
  try {
    const body = (await request.json()) as { locale?: unknown };
    locale = typeof body.locale === "string" ? body.locale : "";
  } catch {
    // fall through to the validation below
  }
  if (!isLocale(locale)) {
    return NextResponse.json({ error: { code: "bad_request" } }, { status: 400 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return response;
}
