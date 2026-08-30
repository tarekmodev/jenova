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
import { sanitizeRecording } from "./sanitize.js";
import { DEFAULT_RECORDINGS_DIR, writeRecordingFile } from "./store.js";
import type { Recording } from "./types.js";

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

  it("detects the review bypass shapes: urlencoded, namespaced XML, CDATA, XML attribute (C1/C2/H1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jenova-credential-guard-"));
    try {
      const planted: Record<string, { file: string; content: string }> = {
        "urlencoded-credential-assignment": {
          // Non-.json extension on purpose — the scan must be extension-agnostic.
          file: "stray-body.txt",
          content: `grant_type=client_credentials&client_id=alpha&client_secret=${"f".repeat(16)}\n`,
        },
        "xml-credential-element": {
          file: "namespaced.json",
          content: `{ "body": "x" }\n<wsse:Password>${"g".repeat(16)}</wsse:Password>\n`,
        },
        "credential-attribute": {
          file: "attribute.json",
          content: `<r session_id="${"i".repeat(16)}"/>\n`,
        },
      };
      await mkdir(join(dir, "example-supplier"), { recursive: true });
      for (const { file, content } of Object.values(planted)) {
        await writeFile(join(dir, "example-supplier", file), content, "utf8");
      }
      // CDATA content inside a credential-named element (H1).
      await writeFile(
        join(dir, "example-supplier", "cdata.json"),
        `<Token><![CDATA[${"h".repeat(16)}]]></Token>\n`,
        "utf8",
      );

      const findings = await scanRecordingsForCredentials(dir);
      for (const [patternName, { file }] of Object.entries(planted)) {
        expect(
          findings.some((f) => f.patternName === patternName && f.file.endsWith(file)),
        ).toBe(true);
      }
      expect(
        findings.some(
          (f) => f.patternName === "xml-credential-element" && f.file.endsWith("cdata.json"),
        ),
      ).toBe(true);
      for (const finding of findings) expect(finding.excerpt).not.toMatch(/[f-i]{12}/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("scans file names as well as contents (H2)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jenova-credential-guard-"));
    try {
      await mkdir(join(dir, "example-supplier"), { recursive: true });
      await writeFile(
        join(dir, "example-supplier", `get-v1-AKIA${"A".repeat(16)}-search.json`),
        '{ "clean": true }\n',
        "utf8",
      );
      const findings = await scanRecordingsForCredentials(dir);
      expect(
        findings.some((f) => f.patternName === "aws-access-key-id" && f.where === "filename"),
      ).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("parity: the raw bypass shapes trip the guard, their sanitized recording does not (H2)", async () => {
    const fake = "k".repeat(20);
    const raw: Recording = {
      schemaVersion: 1,
      supplier: "example-supplier",
      fingerprint: "post-api-example-test-v1-things-abcdef012345",
      request: {
        method: "POST",
        url: `https://api.example.test/v1/things?token=${fake}&q=alpha`,
        headers: {
          authorization: `Bearer ${fake}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: `grant_type=client_credentials&client_secret=${fake}`,
      },
      response: {
        status: 200,
        headers: { "content-type": "application/xml" },
        body: `<x:r sig="ok"><wsse:Password>${fake}</wsse:Password><Token><![CDATA[${fake}]]></Token><q>alpha</q></x:r>`,
      },
      timings: { durationMs: 5 },
    };

    const dir = await mkdtemp(join(tmpdir(), "jenova-credential-guard-"));
    try {
      await writeRecordingFile(dir, raw);
      expect((await scanRecordingsForCredentials(dir)).length).toBeGreaterThan(0);

      await writeRecordingFile(dir, sanitizeRecording(raw));
      expect(await scanRecordingsForCredentials(dir)).toEqual([]);
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
