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

/**
 * Urlencoded credential assignment (`client_secret=...`) inside ANY text
 * value — the fallback pass behind the structured form-urlencoded handling
 * (review C1). The name is kept, the value is redacted.
 */
const URLENCODED_CREDENTIAL_PATTERN = new RegExp(
  `([\\w.-]*(?:${DEFAULT_REDACTED_KEY_PATTERN.source})[\\w.-]*)=(?!\\[REDACTED\\])[^&\\s"'<>]+`,
  "gi",
);

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

/** Strip any namespace prefix: `wsse:Password` → `Password` (review C2). */
function localName(name: string): string {
  const idx = name.lastIndexOf(":");
  return idx === -1 ? name : name.slice(idx + 1);
}

function isCredentialParam(name: string, redaction: ResolvedRedaction): boolean {
  return redaction.queryParams.has(name.toLowerCase()) || isRedactedKey(name, redaction);
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
  return sanitized.replace(URLENCODED_CREDENTIAL_PATTERN, `$1=${REDACTED}`);
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
  // Element content: <ApiKey ...>secret</ApiKey> — match by LOCAL tag name so
  // namespaced elements (<wsse:Password>, <ns2:ApiKey>) are caught (review
  // C2), including <![CDATA[...]]> content (review H1).
  let sanitized = body.replace(
    /<([A-Za-z_][\w.:-]*)((?:\s[^<>]*)?)>((?:<!\[CDATA\[[\s\S]*?\]\]>|[^<])*)<\/\1>/g,
    (whole, tag: string, attrs: string) =>
      isRedactedKey(localName(tag), redaction) ? `<${tag}${attrs}>${REDACTED}</${tag}>` : whole,
  );
  // Attribute values: password="secret" / wsse:Token='secret' — match by
  // local attribute name.
  sanitized = sanitized.replace(
    /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g,
    (whole, name: string, _quoted: string, dq: string | undefined) =>
      isRedactedKey(localName(name), redaction) ? `${name}=${dq === undefined ? "'" : '"'}${REDACTED}${dq === undefined ? "'" : '"'}` : whole,
  );
  return sanitizeText(sanitized);
}

/** `a=1&b=2` with no tags/whitespace — a form-urlencoded body (review C1). */
function isUrlencodedShaped(body: string): boolean {
  return /^[^=&\s<]+=[^&\s]*(?:&[^=&\s<]+=[^&\s]*)*$/.test(body.trim());
}

/**
 * Structured pass for application/x-www-form-urlencoded bodies (review C1) —
 * the OAuth2 client-credentials shape. Redacts by param name using the same
 * merged name logic as sanitizeUrl plus the credential key pattern, while
 * preserving the original encoding of everything kept.
 */
function sanitizeUrlencoded(body: string, redaction: ResolvedRedaction): string {
  return body
    .trim()
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return pair;
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      let decodedName = name;
      try {
        decodedName = decodeURIComponent(name);
      } catch {
        // keep the raw name — redaction still sees it verbatim
      }
      return isCredentialParam(decodedName, redaction)
        ? `${name}=${REDACTED}`
        : `${name}=${sanitizeText(value)}`;
    })
    .join("&");
}

export function sanitizeBody(body: string | null, redaction: ResolvedRedaction): string | null {
  if (body === null) return null;
  try {
    return JSON.stringify(sanitizeJson(JSON.parse(body), redaction));
  } catch {
    // not JSON
  }
  if (isUrlencodedShaped(body)) return sanitizeUrlencoded(body, redaction);
  return sanitizeXml(body, redaction);
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
