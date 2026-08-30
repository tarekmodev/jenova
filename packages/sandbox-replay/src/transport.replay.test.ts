// Structural HTTP examples only — these exercise the replay mechanism.
// Nothing here imitates a real supplier API shape (CLAUDE.md rule 5); real
// recordings arrive in M1 from live sandboxes.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReplayTransport, ReplayMissError, type FetchLike } from "./transport.js";

const SUPPLIER = "example-supplier";

let base: string;
let recordingsDir: string;
let rawCapturesDir: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "jenova-sandbox-replay-"));
  recordingsDir = join(base, "recordings");
  rawCapturesDir = join(base, "raw-captures");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const NETWORK_FORBIDDEN: FetchLike = () => {
  throw new Error("replay mode must never touch the network");
};

async function recordOnce(status: number, body: string): Promise<void> {
  const record = createReplayTransport({
    mode: "record",
    supplier: SUPPLIER,
    recordingsDir,
    rawCapturesDir,
    fetch: () =>
      Promise.resolve(
        new Response(body, { status, headers: { "content-type": "application/json" } }),
      ),
  });
  await record("https://api.example.test/v1/items?b=2&a=1&ts=111", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"q":"alpha"}',
  });
}

describe("replay mode", () => {
  it("resolves recorded interactions without touching the network", async () => {
    await recordOnce(200, '{"ok":true}');
    const replay = createReplayTransport({
      mode: "replay",
      supplier: SUPPLIER,
      recordingsDir,
      fetch: NETWORK_FORBIDDEN,
    });
    // Param order and volatile param VALUES differ from the recorded request
    // — normalization must still resolve the same recording.
    const response = await replay("https://api.example.test/v1/items?a=1&b=2&ts=999", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{ "q": "alpha" }',
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
    expect(response.headers.get("content-type")).toBe("application/json");
  });

  it("replays non-2xx recordings as-is", async () => {
    await recordOnce(429, '{"retry":true}');
    const replay = createReplayTransport({ mode: "replay", supplier: SUPPLIER, recordingsDir });
    const response = await replay("https://api.example.test/v1/items?a=1&b=2&ts=222", {
      method: "POST",
      body: '{"q":"alpha"}',
    });
    expect(response.status).toBe(429);
  });

  it("fails loudly on a fingerprint miss — never a silent fallback", async () => {
    const replay = createReplayTransport({
      mode: "replay",
      supplier: SUPPLIER,
      recordingsDir,
      fetch: NETWORK_FORBIDDEN,
    });
    const attempt = replay("https://api.example.test/v1/unrecorded", { method: "GET" });
    await expect(attempt).rejects.toThrow(ReplayMissError);
    await expect(attempt).rejects.toThrow(
      /^record this scenario first: get-api-example-test-v1-unrecorded-[0-9a-f]{12} \(supplier example-supplier\)$/,
    );
  });

  it("misses when the request meaningfully differs from what was recorded", async () => {
    await recordOnce(200, '{"ok":true}');
    const replay = createReplayTransport({ mode: "replay", supplier: SUPPLIER, recordingsDir });
    await expect(
      replay("https://api.example.test/v1/items?a=1&b=2&ts=222", {
        method: "POST",
        body: '{"q":"beta"}',
      }),
    ).rejects.toThrow(ReplayMissError);
  });
});
