/**
 * Authenticated streaming proxy: browser → portal → api.
 *
 * Exists for two reasons only:
 * 1. the agency bearer token lives in an httpOnly cookie (never readable by
 *    client JS) and is attached here;
 * 2. the api resolves the tenant from the Host header, which browsers and
 *    fetch cannot set cross-origin — the proxy forwards the ORIGINAL host.
 *
 * Allowlisted api prefixes only — this is a portal session bridge, not an
 * open proxy. Responses stream through untouched (the hotel-search SSE
 * stays progressive; X-Accel-Buffering: no is preserved).
 */

import { Readable } from "node:stream";
import { NextResponse, type NextRequest } from "next/server";
import { apiRequest } from "../../../lib/api-server";
import { SESSION_COOKIE } from "../../../lib/session";

export const dynamic = "force-dynamic";

const ALLOWED_PREFIXES = [
  "hotel-search",
  "hotel-content/",
  "offers/",
  "bookings",
] as const;

function allowed(path: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => path === prefix.replace(/\/$/, "") || path.startsWith(prefix));
}

async function proxy(request: NextRequest, params: Promise<{ path: string[] }>): Promise<Response> {
  const segments = (await params).path;
  const path = segments.join("/");
  if (!allowed(path)) {
    return NextResponse.json(
      { error: { code: "not_found", message: "unknown portal api path", requestId: "" } },
      { status: 404 },
    );
  }
  const token = request.cookies.get(SESSION_COOKIE)?.value ?? null;
  if (token === null) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "no portal session", requestId: "" } },
      { status: 401 },
    );
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: request.headers.get("accept") ?? "application/json",
  };
  let body: Buffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = Buffer.from(await request.arrayBuffer());
    headers["content-type"] = request.headers.get("content-type") ?? "application/json";
  }

  const upstream = await apiRequest({
    method: request.method,
    path: `/${path}${request.nextUrl.search}`,
    tenantHost: request.headers.get("host") ?? "",
    headers,
    body,
  });

  const responseHeaders = new Headers();
  for (const name of ["content-type", "cache-control", "x-request-id", "x-accel-buffering"]) {
    const value = upstream.headers[name];
    if (typeof value === "string") {
      responseHeaders.set(name, value);
    }
  }
  return new Response(Readable.toWeb(upstream.stream) as ReadableStream<Uint8Array>, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return proxy(request, context.params);
}

export function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return proxy(request, context.params);
}
