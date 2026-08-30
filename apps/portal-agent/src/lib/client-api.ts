"use client";

/**
 * Browser-side calls, always through the portal's authenticated proxy
 * (/portal-api) — the session token never exists client-side. A 401 anywhere
 * means the session died: bounce to login.
 */

import { errorCodeOf } from "./types";

export class PortalApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`portal api error ${String(status)}${code === null ? "" : ` (${code})`}`);
    this.name = "PortalApiError";
  }
}

export async function portalGet<T>(path: string): Promise<T> {
  const response = await fetch(`/portal-api/${path}`, { cache: "no-store" });
  return handle<T>(response);
}

export async function portalPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/portal-api/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return handle<T>(response);
}

async function handle<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    window.location.assign("/login");
    throw new PortalApiError(401, "unauthorized");
  }
  const text = await response.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!response.ok) {
    throw new PortalApiError(response.status, errorCodeOf(json));
  }
  return json as T;
}
