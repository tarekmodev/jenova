// Structural HTTP examples only — these exercise the sanitization mechanism.
// Credential-shaped values below are synthetic (repeated filler characters);
// nothing imitates a real supplier API shape (CLAUDE.md rule 5).
import { describe, expect, it } from "vitest";
import {
  REDACTED,
  resolveRedaction,
  sanitizeBody,
  sanitizeHeaders,
  sanitizeRecording,
  sanitizeUrl,
} from "./sanitize.js";
import type { Recording } from "./types.js";

const redaction = resolveRedaction();
const FAKE_TOKEN = "x".repeat(24);

describe("sanitizeHeaders", () => {
  it("redacts credential headers case-insensitively, keeps the rest", () => {
    const sanitized = sanitizeHeaders(
      {
        Authorization: `Bearer ${FAKE_TOKEN}`,
        "X-API-Key": FAKE_TOKEN,
        "content-type": "application/json",
      },
      redaction,
    );
    expect(sanitized["Authorization"]).toBe(REDACTED);
    expect(sanitized["X-API-Key"]).toBe(REDACTED);
    expect(sanitized["content-type"]).toBe("application/json");
  });

  it("honors extra names from the configurable redaction list", () => {
    const custom = resolveRedaction({ headers: ["x-vendor-credential"] });
    const sanitized = sanitizeHeaders({ "x-vendor-credential": FAKE_TOKEN }, custom);
    expect(sanitized["x-vendor-credential"]).toBe(REDACTED);
  });
});

describe("sanitizeUrl", () => {
  it("redacts credential query params and basic-auth userinfo", () => {
    const sanitized = sanitizeUrl(
      `https://user:pass@api.example.test/v1/items?apiKey=${FAKE_TOKEN}&q=alpha`,
      redaction,
    );
    expect(sanitized).not.toContain(FAKE_TOKEN);
    expect(sanitized).not.toContain("pass");
    expect(sanitized).toContain("q=alpha");
  });
});

describe("sanitizeBody", () => {
  it("redacts credential keys in JSON at any depth", () => {
    const sanitized = sanitizeBody(
      JSON.stringify({ q: "alpha", auth: { apiKey: FAKE_TOKEN, password: "hunter2hunter2" } }),
      redaction,
    );
    expect(sanitized).not.toContain(FAKE_TOKEN);
    expect(sanitized).not.toContain("hunter2hunter2");
    expect(sanitized).toContain('"q":"alpha"');
  });

  it("redacts bearer tokens embedded in JSON string values", () => {
    const sanitized = sanitizeBody(
      JSON.stringify({ note: `use Bearer ${FAKE_TOKEN} next` }),
      redaction,
    );
    expect(sanitized).not.toContain(FAKE_TOKEN);
  });

  it("redacts credential elements and attributes in XML", () => {
    const sanitized = sanitizeBody(
      `<req session_id='${FAKE_TOKEN}'><ApiKey>${FAKE_TOKEN}</ApiKey><q>alpha</q></req>`,
      redaction,
    );
    expect(sanitized).not.toContain(FAKE_TOKEN);
    expect(sanitized).toContain("<q>alpha</q>");
  });
});

describe("sanitizeRecording", () => {
  it("sanitizes both sides and preserves everything else", () => {
    const recording: Recording = {
      schemaVersion: 1,
      supplier: "example-supplier",
      fingerprint: "post-api-example-test-v1-items-abcdef012345",
      request: {
        method: "POST",
        url: `https://api.example.test/v1/items?token=${FAKE_TOKEN}`,
        headers: { authorization: `Basic ${Buffer.from("u:p".repeat(6)).toString("base64")}` },
        body: JSON.stringify({ apiKey: FAKE_TOKEN, q: "alpha" }),
      },
      response: {
        status: 200,
        headers: { "set-cookie": `sid=${FAKE_TOKEN}` },
        body: JSON.stringify({ access_token: FAKE_TOKEN, ok: true }),
      },
      timings: { durationMs: 12 },
    };
    const sanitized = sanitizeRecording(recording);
    expect(JSON.stringify(sanitized)).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(sanitized)).not.toContain("Basic ");
    expect(sanitized.request.body).toContain('"q":"alpha"');
    expect(sanitized.response.body).toContain('"ok":true');
    expect(sanitized.response.status).toBe(200);
    expect(sanitized.fingerprint).toBe(recording.fingerprint);
    expect(sanitized.timings.durationMs).toBe(12);
  });
});
