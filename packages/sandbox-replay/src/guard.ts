import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { DEFAULT_REDACTED_KEY_PATTERN, DEFAULT_REDACTED_PARAMS } from "./sanitize.js";

// Guard parity (review H2): every name shape the sanitizer redacts by must
// also be a shape the guard detects, so a sanitizer regression cannot pass CI.
const KEY_WORDS = `(?:${DEFAULT_REDACTED_KEY_PATTERN.source})`;
const PARAM_NAMES = DEFAULT_REDACTED_PARAMS.join("|");
const CREDENTIAL_NAME = `(?:[\\w.-]*${KEY_WORDS}[\\w.-]*|${PARAM_NAMES})`;
// The sanitizer's placeholder, literal or percent-encoded (URL serialization
// encodes the brackets: %5BREDACTED%5D).
const REDACTED_MARK = `(?:\\[REDACTED\\]|%5BREDACTED%5D)`;

/**
 * Credential shapes that must never appear in a committed recording. The
 * guard test scans recordings/ with these on every CI run; any match fails
 * the build (issue #28 — quarantine gate).
 */
export const CREDENTIAL_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: "bearer-token", pattern: /\bBearer\s+(?!\[REDACTED\])[A-Za-z0-9._~+/=-]{8,}/ },
  { name: "basic-auth-base64", pattern: /\bBasic\s+(?!\[REDACTED\])[A-Za-z0-9+/=]{8,}/ },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/ },
  { name: "aws-access-key-id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "prefixed-secret-key", pattern: /\b[a-z]{2}_(?:live|test|prod)_[A-Za-z0-9]{12,}\b/ },
  {
    name: "credential-assignment",
    pattern:
      /"(?:[\w-]*(?:password|passwd|secret|api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret)[\w-]*)"\s*:\s*"(?!\[REDACTED\])[^"]{4,}"/i,
  },
  {
    // client_secret=... — form-urlencoded / query-string style (review C1).
    name: "urlencoded-credential-assignment",
    pattern: new RegExp(`\\b${CREDENTIAL_NAME}=(?!${REDACTED_MARK})[^&\\s"'<>\\\\]{4,}`, "i"),
  },
  {
    // password="..." / wsse:Token='...' — XML-attribute style (review C2).
    name: "credential-attribute",
    pattern: new RegExp(
      `\\b[\\w.:-]*${KEY_WORDS}[\\w.:-]*\\s*=\\s*(?:"(?!${REDACTED_MARK})[^"]{4,}"|'(?!${REDACTED_MARK})[^']{4,}')`,
      "i",
    ),
  },
  {
    // <wsse:Password>...</> incl. CDATA content (review C2 + H1).
    name: "xml-credential-element",
    pattern: new RegExp(
      `<(?:[\\w.-]+:)?[\\w.-]*${KEY_WORDS}[\\w.-]*(?:\\s[^<>]*)?>\\s*(?:<!\\[CDATA\\[)?\\s*(?!${REDACTED_MARK})[^<\\s][^<]{2,}`,
      "i",
    ),
  },
];

export interface CredentialFinding {
  file: string;
  patternName: string;
  /** Where the pattern matched: the file's content, or its path/name. */
  where: "content" | "filename";
  /** Masked evidence — never the credential itself. */
  excerpt: string;
}

function mask(match: string): string {
  return match.length <= 12 ? "***" : `${match.slice(0, 8)}…(${String(match.length)} chars)`;
}

/** Every file under recordings/, regardless of extension (review H2). */
async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

/**
 * Scan every committed recording for credential material — file contents AND
 * file names (fingerprints embed URL path segments, which can carry
 * path-embedded keys). Returns findings (empty means clean). Runs in CI via
 * credential-guard.test.ts.
 */
export async function scanRecordingsForCredentials(
  recordingsDir: string,
): Promise<CredentialFinding[]> {
  const findings: CredentialFinding[] = [];
  let files: string[];
  try {
    files = await listFiles(recordingsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  for (const file of files) {
    const relativePath = relative(recordingsDir, file);
    const content = await readFile(file, "utf8");
    for (const { name, pattern } of CREDENTIAL_PATTERNS) {
      const contentMatch = pattern.exec(content);
      if (contentMatch) {
        findings.push({ file, patternName: name, where: "content", excerpt: mask(contentMatch[0]) });
      }
      const nameMatch = pattern.exec(relativePath);
      if (nameMatch) {
        findings.push({ file, patternName: name, where: "filename", excerpt: mask(nameMatch[0]) });
      }
    }
  }
  return findings;
}
