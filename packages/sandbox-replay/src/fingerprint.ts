import { createHash } from "node:crypto";

/**
 * Query params / JSON body keys whose VALUES vary between otherwise-identical
 * requests (clocks, nonces, correlation ids). Their values are normalized to
 * "~" before hashing so a re-run resolves to the same recording; their
 * presence still participates in the fingerprint.
 */
export const DEFAULT_VOLATILE_PARAMS: readonly string[] = [
  "timestamp",
  "ts",
  "time",
  "nonce",
  "rand",
  "random",
  "echotoken",
  "echo_token",
  "requestid",
  "request_id",
  "correlationid",
  "correlation_id",
  "traceid",
  "trace_id",
];

export interface FingerprintOptions {
  /** Extra volatile query-param names, merged with DEFAULT_VOLATILE_PARAMS. */
  volatileParams?: readonly string[];
  /** Extra volatile JSON body keys, merged with DEFAULT_VOLATILE_PARAMS. */
  volatileBodyKeys?: readonly string[];
}

const NORMALIZED = "~";

function volatileSet(extra: readonly string[] | undefined): ReadonlySet<string> {
  return new Set([...DEFAULT_VOLATILE_PARAMS, ...(extra ?? [])].map((name) => name.toLowerCase()));
}

/** Sort query params and blank out volatile values; drop any fragment. */
export function normalizeUrl(rawUrl: string, volatileParams: ReadonlySet<string>): string {
  const url = new URL(rawUrl);
  url.hash = "";
  const entries = [...url.searchParams.entries()]
    .map(([name, value]): [string, string] =>
      volatileParams.has(name.toLowerCase()) ? [name, NORMALIZED] : [name, value],
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = "";
  for (const [name, value] of entries) url.searchParams.append(name, value);
  return url.toString();
}

function sortJson(value: unknown, volatileKeys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJson(item, volatileKeys));
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = volatileKeys.has(key.toLowerCase())
        ? NORMALIZED
        : sortJson((value as Record<string, unknown>)[key], volatileKeys);
    }
    return sorted;
  }
  return value;
}

/**
 * Canonical text for hashing: JSON is re-serialized with sorted keys and
 * volatile values normalized; XML/other text has inter-tag and run whitespace
 * collapsed so formatting differences do not change the fingerprint.
 */
export function canonicalizeBody(body: string | null, volatileKeys: ReadonlySet<string>): string {
  if (body === null || body.trim() === "") return "";
  try {
    return JSON.stringify(sortJson(JSON.parse(body), volatileKeys));
  } catch {
    return body.trim().replace(/>\s+</g, "><").replace(/\s+/g, " ");
  }
}

function slugify(url: URL): string {
  const raw = `${url.hostname}${url.pathname}`;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.slice(0, 60).replace(/-$/, "");
}

/**
 * Stable identity of one supplier interaction: method + URL (volatile params
 * normalized) + canonicalized body hash. Doubles as the recording filename
 * (plus ".json"), so it stays filesystem-safe and human-scannable.
 */
export function fingerprintRequest(
  method: string,
  rawUrl: string,
  body: string | null,
  options: FingerprintOptions = {},
): string {
  const params = volatileSet(options.volatileParams);
  const bodyKeys = volatileSet(options.volatileBodyKeys);
  const normalizedUrl = normalizeUrl(rawUrl, params);
  const canonicalBody = canonicalizeBody(body, bodyKeys);
  const hash = createHash("sha256")
    .update(`${method.toUpperCase()}\n${normalizedUrl}\n${canonicalBody}`)
    .digest("hex")
    .slice(0, 12);
  return `${method.toLowerCase()}-${slugify(new URL(rawUrl))}-${hash}`;
}
