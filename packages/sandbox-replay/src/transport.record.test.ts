// Structural HTTP examples only — these exercise the recording mechanism.
// Nothing here imitates a real supplier API shape (CLAUDE.md rule 5); real
// recordings arrive in M1 from live sandboxes.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fingerprintRequest } from "./fingerprint.js";
import { recordingPath } from "./store.js";
import { createReplayTransport, type FetchLike } from "./transport.js";
import type { Recording } from "./types.js";

const SUPPLIER = "example-supplier";

let recordingsDir: string;
let rawCapturesDir: string;

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), "jenova-sandbox-replay-"));
  recordingsDir = join(base, "recordings");
  rawCapturesDir = join(base, "raw-captures");
});

afterEach(async () => {
  await rm(join(recordingsDir, ".."), { recursive: true, force: true });
});

function stubFetch(status: number, body: string, headers: Record<string, string>): FetchLike {
  return () => Promise.resolve(new Response(body, { status, headers }));
}

describe("record mode", () => {
  it("persists one recording per interaction, keyed by fingerprint", async () => {
    const transport = createReplayTransport({
      mode: "record",
      supplier: SUPPLIER,
      recordingsDir,
      rawCapturesDir,
      fetch: stubFetch(200, '{"ok":true}', { "content-type": "application/json" }),
    });

    const url = "https://api.example.test/v1/items?b=2&a=1";
    const body = '{"q":"alpha"}';
    const response = await transport(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');

    const fingerprint = fingerprintRequest("POST", url, body);
    const raw = await readFile(recordingPath(recordingsDir, SUPPLIER, fingerprint), "utf8");
    const recording = JSON.parse(raw) as Recording;
    expect(recording.schemaVersion).toBe(1);
    expect(recording.supplier).toBe(SUPPLIER);
    expect(recording.fingerprint).toBe(fingerprint);
    expect(recording.request).toMatchObject({ method: "POST", url, body });
    expect(recording.response.status).toBe(200);
    expect(recording.response.body).toBe('{"ok":true}');
    expect(recording.timings.durationMs).toBeTypeOf("number");
  });

  it("writes deterministic, human-diffable JSON (sorted headers, trailing newline)", async () => {
    const transport = createReplayTransport({
      mode: "record",
      supplier: SUPPLIER,
      recordingsDir,
      rawCapturesDir,
      fetch: stubFetch(200, "<r><a>1</a></r>", { "content-type": "application/xml" }),
    });
    await transport("https://api.example.test/v1/items", {
      method: "POST",
      headers: { "x-b": "2", "X-A": "1" },
      body: "<q><term>alpha</term></q>",
    });

    const fingerprint = fingerprintRequest(
      "POST",
      "https://api.example.test/v1/items",
      "<q><term>alpha</term></q>",
    );
    const raw = await readFile(recordingPath(recordingsDir, SUPPLIER, fingerprint), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    const headerNames = Object.keys((JSON.parse(raw) as Recording).request.headers);
    expect(headerNames).toEqual([...headerNames].sort());
    expect(headerNames).toContain("x-a");
  });

  it("sanitizes recordings/ while the raw capture stays quarantined in raw-captures/", async () => {
    const fakeToken = "y".repeat(24);
    const transport = createReplayTransport({
      mode: "record",
      supplier: SUPPLIER,
      recordingsDir,
      rawCapturesDir,
      fetch: stubFetch(200, `{"access_token":"${fakeToken}","ok":true}`, {
        "set-cookie": `sid=${fakeToken}`,
      }),
    });

    const url = `https://api.example.test/v1/items?apiKey=${fakeToken}&q=alpha`;
    await transport(url, {
      method: "GET",
      headers: { authorization: `Bearer ${fakeToken}` },
    });

    const fingerprint = fingerprintRequest("GET", url, null, {
      volatileParams: ["apiKey"],
    });
    const recording = await readFile(recordingPath(recordingsDir, SUPPLIER, fingerprint), "utf8");
    expect(recording).not.toContain(fakeToken);
    expect(recording).toContain("[REDACTED]");
    expect(recording).toContain("q=alpha");

    const raw = await readFile(recordingPath(rawCapturesDir, SUPPLIER, fingerprint), "utf8");
    expect(raw).toContain(fakeToken);
  });

  it("keeps the fingerprint stable when credentials rotate", async () => {
    const transport = createReplayTransport({
      mode: "record",
      supplier: SUPPLIER,
      recordingsDir,
      rawCapturesDir,
      fetch: stubFetch(200, '{"ok":true}', {}),
    });
    await transport("https://api.example.test/v1/items?q=alpha&token=oldoldoldoldold1");
    await transport("https://api.example.test/v1/items?q=alpha&token=newnewnewnewnew2");

    const supplierDir = join(recordingsDir, SUPPLIER);
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(supplierDir)).toHaveLength(1);
  });

  it("refuses to record over the network under CI", () => {
    const original = process.env["CI"];
    process.env["CI"] = "true";
    try {
      expect(() =>
        createReplayTransport({ mode: "record", supplier: SUPPLIER, recordingsDir, rawCapturesDir }),
      ).toThrow(/forbidden in CI/);
    } finally {
      if (original === undefined) delete process.env["CI"];
      else process.env["CI"] = original;
    }
  });

  it("rejects non-text bodies loudly", async () => {
    const transport = createReplayTransport({
      mode: "record",
      supplier: SUPPLIER,
      recordingsDir,
      rawCapturesDir,
      fetch: stubFetch(200, "", {}),
    });
    await expect(
      transport("https://api.example.test/v1/items", {
        method: "POST",
        body: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toThrow(/text bodies/);
  });
});
