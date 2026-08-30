import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

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
];

export interface CredentialFinding {
  file: string;
  patternName: string;
  /** Masked evidence — never the credential itself. */
  excerpt: string;
}

function mask(match: string): string {
  return match.length <= 12 ? "***" : `${match.slice(0, 8)}…(${String(match.length)} chars)`;
}

async function listJsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(entry.parentPath, entry.name));
}

/**
 * Scan every committed recording for credential material. Returns findings
 * (empty means clean). Runs in CI via credential-guard.test.ts.
 */
export async function scanRecordingsForCredentials(
  recordingsDir: string,
): Promise<CredentialFinding[]> {
  const findings: CredentialFinding[] = [];
  let files: string[];
  try {
    files = await listJsonFiles(recordingsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const { name, pattern } of CREDENTIAL_PATTERNS) {
      const match = pattern.exec(content);
      if (match) findings.push({ file, patternName: name, excerpt: mask(match[0]) });
    }
  }
  return findings;
}
