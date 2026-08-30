/**
 * Server-side bridge to the Jenova api (server components + route handlers
 * only — never bundled client-side).
 *
 * Uses node:http directly because the api resolves the TENANT from the Host
 * header (gateway stage 1) and fetch/undici forbids setting Host. Every
 * outbound call carries the ORIGINAL incoming host, so the tenant the
 * browser addressed is the tenant the api serves — the portal can never
 * cross tenants by construction.
 */

import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Readable } from "node:stream";

export function apiOrigin(): string {
  return process.env["JENOVA_API_ORIGIN"] ?? "http://localhost:3000";
}

export interface UpstreamResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly stream: Readable & IncomingMessage;
}

export interface ApiRequestOptions {
  readonly method: string;
  /** Path + query, starting with "/". */
  readonly path: string;
  /** The browser-facing host — forwarded so tenant resolution matches. */
  readonly tenantHost: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Buffer | undefined;
}

export function apiRequest(options: ApiRequestOptions): Promise<UpstreamResponse> {
  const origin = new URL(apiOrigin());
  const doRequest = origin.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = doRequest(
      {
        protocol: origin.protocol,
        hostname: origin.hostname,
        port: origin.port,
        method: options.method,
        path: options.path,
        headers: {
          ...options.headers,
          host: options.tenantHost,
        },
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          stream: res,
        });
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

export async function readBody(response: UpstreamResponse): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of response.stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface JsonResponse {
  readonly status: number;
  readonly json: unknown;
}

export async function apiJson(options: ApiRequestOptions): Promise<JsonResponse> {
  const response = await apiRequest({
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers,
    },
  });
  const text = await readBody(response);
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, json };
}
