import type { Recording } from "./types.js";

export const REDACTED = "[REDACTED]";

/**
 * Safe defaults for credential material. A supplier adapter merges its own
 * names on top via RedactionConfig — never by weakening these.
 */
export const DEFAULT_REDACTED_HEADERS: readonly string[] = [
  "authorization",
  "proxy-authorization",
  "www-authenticate",
  "cookie",
  "set-cookie",
  "api-key",
  "apikey",
  "x-api-key",
  "x-apikey",
  "x-auth-token",
  "x-access-token",
  "x-token",
  "x-session-token",
  "x-signature",
  "signature",
  "x-amz-security-token",
  "ocp-apim-subscription-key",
];

export const DEFAULT_REDACTED_PARAMS: readonly string[] = [
  "api_key",
  "api-key",
  "apikey",
  "key",
  "token",
  "access_token",
  "auth",
  "auth_token",
  "signature",
  "sig",
  "password",
  "secret",
  "client_secret",
  "session",
  "sessionid",
  "session_id",
];

/** JSON keys / XML element+attribute names whose values are credentials. */
export const DEFAULT_REDACTED_KEY_PATTERN =
  /passw(or)?d|secret|token|api[-_]?key|signature|credential|session[-_]?id|auth/i;

/** Credential shapes redacted wherever they appear inside text values. */
const TEXT_CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}/g,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
];

export interface RedactionConfig {
  /** Extra header names, merged with DEFAULT_REDACTED_HEADERS. */
  headers?: readonly string[];
  /** Extra URL query-param names, merged with DEFAULT_REDACTED_PARAMS. */
  queryParams?: readonly string[];
  /** Extra JSON/XML key names, redacted in addition to the default pattern. */
  bodyKeys?: readonly string[];
}

interface ResolvedRedaction {
  headers: ReadonlySet<string>;
  queryParams: ReadonlySet<string>;
  bodyKeys: ReadonlySet<string>;
}

export function resolveRedaction(config: RedactionConfig = {}): ResolvedRedaction {
  const lower = (names: readonly string[]): string[] => names.map((n) => n.toLowerCase());
  return {
    headers: new Set([...lower(DEFAULT_REDACTED_HEADERS), ...lower(config.headers ?? [])]),
    queryParams: new Set([...lower(DEFAULT_REDACTED_PARAMS), ...lower(config.queryParams ?? [])]),
    bodyKeys: new Set(lower(config.bodyKeys ?? [])),
  };
}

function isRedactedKey(key: string, redaction: ResolvedRedaction): boolean {
  return DEFAULT_REDACTED_KEY_PATTERN.test(key) || redaction.bodyKeys.has(key.toLowerCase());
}

export function sanitizeHeaders(
  headers: Record<string, string>,
  redaction: ResolvedRedaction,
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    sanitized[name] = redaction.headers.has(name.toLowerCase())
      ? REDACTED
      : sanitizeText(value);
  }
  return sanitized;
}

export function sanitizeUrl(rawUrl: string, redaction: ResolvedRedaction): string {
  const url = new URL(rawUrl);
  for (const name of [...url.searchParams.keys()]) {
    if (redaction.queryParams.has(name.toLowerCase())) url.searchParams.set(name, REDACTED);
  }
  if (url.username !== "" || url.password !== "") {
    url.username = REDACTED;
    url.password = "";
  }
  return url.toString();
}

/** Redact credential-shaped substrings inside any text value. */
export function sanitizeText(text: string): string {
  let sanitized = text;
  for (const pattern of TEXT_CREDENTIAL_PATTERNS) {
    sanitized = sanitized.replace(pattern, REDACTED);
  }
  return sanitized;
}

function sanitizeJson(value: unknown, redaction: ResolvedRedaction): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeJson(item, redaction));
  if (value !== null && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = isRedactedKey(key, redaction) ? REDACTED : sanitizeJson(entry, redaction);
    }
    return sanitized;
  }
  if (typeof value === "string") return sanitizeText(value);
  return value;
}

function sanitizeXml(body: string, redaction: ResolvedRedaction): string {
  // Element content: <ApiKey ...>secret</ApiKey> — match by tag name.
  let sanitized = body.replace(
    /<([A-Za-z_][\w.-]*)((?:\s[^<>]*)?)>([^<]*)<\/\1>/g,
    (whole, tag: string, attrs: string) =>
      isRedactedKey(tag, redaction) ? `<${tag}${attrs}>${REDACTED}</${tag}>` : whole,
  );
  // Attribute values: password="secret" / token='secret' — match by attribute name.
  sanitized = sanitized.replace(
    /([A-Za-z_][\w.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g,
    (whole, name: string, _quoted: string, dq: string | undefined) =>
      isRedactedKey(name, redaction) ? `${name}=${dq === undefined ? "'" : '"'}${REDACTED}${dq === undefined ? "'" : '"'}` : whole,
  );
  return sanitizeText(sanitized);
}

export function sanitizeBody(body: string | null, redaction: ResolvedRedaction): string | null {
  if (body === null) return null;
  try {
    return JSON.stringify(sanitizeJson(JSON.parse(body), redaction));
  } catch {
    return sanitizeXml(body, redaction);
  }
}

/**
 * The single gate between a raw capture and recordings/ (CLAUDE.md rule 5,
 * docs/09-testing.md): everything persisted for commit passes through here.
 */
export function sanitizeRecording(recording: Recording, config: RedactionConfig = {}): Recording {
  const redaction = resolveRedaction(config);
  return {
    schemaVersion: recording.schemaVersion,
    supplier: recording.supplier,
    fingerprint: recording.fingerprint,
    request: {
      method: recording.request.method,
      url: sanitizeUrl(recording.request.url, redaction),
      headers: sanitizeHeaders(recording.request.headers, redaction),
      body: sanitizeBody(recording.request.body, redaction),
    },
    response: {
      status: recording.response.status,
      headers: sanitizeHeaders(recording.response.headers, redaction),
      body: sanitizeBody(recording.response.body, redaction),
    },
    timings: { durationMs: recording.timings.durationMs },
  };
}
