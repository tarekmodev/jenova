/**
 * Authenticated pass-through to the api for CLIENT components: the
 * httpOnly session cookie never reaches page script, so browser-side
 * calls come here and leave with the realm-tagged bearer attached.
 *
 * The upstream body is piped verbatim (streams included — the search
 * console's SSE flows through this same handler), so the api's error
 * envelopes, event frames and status codes reach the client untouched.
 * Only staff surfaces and the search stream are reachable; the api's own
 * authorization still decides everything — this proxy adds no rights.
 */

import type { NextRequest } from "next/server";
import { apiFetch } from "../../../../lib/api";

const ALLOWED_PREFIXES = ["staff/", "hotel-search"] as const;

async function forward(
  request: NextRequest,
  params: Promise<{ path: string[] }>,
): Promise<Response> {
  const { path } = await params;
  const joined = path.join("/");
  if (!ALLOWED_PREFIXES.some((prefix) => joined === prefix.replace(/\/$/, "") || joined.startsWith(prefix))) {
    return Response.json(
      { error: { code: "not_found", message: "unknown proxy path", requestId: "" } },
      { status: 404 },
    );
  }
  const search = request.nextUrl.search;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await apiFetch(`/${joined}${search}`, {
    method: request.method,
    ...(hasBody ? { body: await request.text() } : {}),
    headers: {
      ...(hasBody ? { "content-type": request.headers.get("content-type") ?? "application/json" } : {}),
      accept: request.headers.get("accept") ?? "application/json",
    },
  });
  const headers = new Headers();
  for (const name of ["content-type", "cache-control", "x-request-id"]) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

export function GET(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return forward(request, ctx.params);
}
export function POST(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return forward(request, ctx.params);
}
export function PUT(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return forward(request, ctx.params);
}
export function PATCH(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return forward(request, ctx.params);
}
export function DELETE(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return forward(request, ctx.params);
}
