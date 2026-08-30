// CI gate (issue #28): recordings/ must never contain credential material,
// and raw-captures/ must stay gitignored. Planted values below are synthetic
// filler used to prove the scanner detects each shape — no real credentials,
// no supplier API shapes (CLAUDE.md rule 5).
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanRecordingsForCredentials } from "./guard.js";
import { DEFAULT_RECORDINGS_DIR } from "./store.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

describe("credential guard (runs in CI)", () => {
  it("finds no credential material in committed recordings/", async () => {
    const findings = await scanRecordingsForCredentials(DEFAULT_RECORDINGS_DIR);
    expect(findings).toEqual([]);
  });

  it("detects every guarded credential shape when planted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jenova-credential-guard-"));
    try {
      const planted: Record<string, string> = {
        "bearer-token": `"authorization": "Bearer ${"a".repeat(24)}"`,
        "basic-auth-base64": `"authorization": "Basic ${Buffer.from("user:secret-filler").toString("base64")}"`,
        jwt: `"assertion": "eyJ${"a".repeat(10)}.eyJ${"b".repeat(10)}.${"c".repeat(10)}"`,
        "aws-access-key-id": '"key_id": "AKIA' + "A".repeat(16) + '"',
        "prefixed-secret-key": `"secret": "sk_test_${"d".repeat(16)}"`,
        "credential-assignment": `"client_secret": "${"e".repeat(16)}"`,
      };
      await mkdir(join(dir, "example-supplier"), { recursive: true });
      for (const [name, snippet] of Object.entries(planted)) {
        await writeFile(join(dir, "example-supplier", `${name}.json`), `{ ${snippet} }\n`, "utf8");
      }
      const findings = await scanRecordingsForCredentials(dir);
      const detected = new Set(findings.map((finding) => finding.patternName));
      for (const name of Object.keys(planted)) expect(detected).toContain(name);
      // Findings carry masked evidence only — never the credential itself.
      for (const finding of findings) expect(finding.excerpt).not.toMatch(/[a-e]{12}/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not flag sanitized placeholders", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jenova-credential-guard-"));
    try {
      await mkdir(join(dir, "example-supplier"), { recursive: true });
      await writeFile(
        join(dir, "example-supplier", "clean.json"),
        '{ "authorization": "[REDACTED]", "client_secret": "[REDACTED]" }\n',
        "utf8",
      );
      expect(await scanRecordingsForCredentials(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("raw-capture quarantine", () => {
  it("keeps raw-captures/ gitignored at the repo root", async () => {
    const gitignore = await readFile(join(REPO_ROOT, ".gitignore"), "utf8");
    expect(gitignore).toMatch(/^packages\/sandbox-replay\/raw-captures\/$/m);
  });
});
