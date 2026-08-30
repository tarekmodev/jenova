// Structural HTTP examples only — these exercise the fingerprinting mechanism.
// Nothing here imitates a real supplier API shape (CLAUDE.md rule 5); real
// recordings arrive in M1 from live sandboxes.
import { describe, expect, it } from "vitest";
import { canonicalizeBody, fingerprintRequest, normalizeUrl } from "./fingerprint.js";

const volatile = new Set(["ts", "nonce"]);

describe("normalizeUrl", () => {
  it("sorts query params so ordering does not change identity", () => {
    expect(normalizeUrl("https://api.example.test/v1/items?b=2&a=1", volatile)).toBe(
      normalizeUrl("https://api.example.test/v1/items?a=1&b=2", volatile),
    );
  });

  it("normalizes volatile param values but keeps their presence", () => {
    const a = normalizeUrl("https://api.example.test/v1/items?a=1&ts=111", volatile);
    const b = normalizeUrl("https://api.example.test/v1/items?a=1&ts=222", volatile);
    const c = normalizeUrl("https://api.example.test/v1/items?a=1", volatile);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("canonicalizeBody", () => {
  it("makes JSON key order and whitespace irrelevant", () => {
    expect(canonicalizeBody('{ "b": 2,\n  "a": 1 }', volatile)).toBe(
      canonicalizeBody('{"a":1,"b":2}', volatile),
    );
  });

  it("normalizes volatile JSON keys at any depth", () => {
    expect(canonicalizeBody('{"a":{"nonce":"x1"},"b":2}', volatile)).toBe(
      canonicalizeBody('{"a":{"nonce":"x2"},"b":2}', volatile),
    );
  });

  it("collapses XML formatting whitespace", () => {
    expect(canonicalizeBody("<r>\n  <a>1</a>\n</r>", volatile)).toBe(
      canonicalizeBody("<r><a>1</a></r>", volatile),
    );
  });

  it("keeps distinct XML content distinct", () => {
    expect(canonicalizeBody("<r><a>1</a></r>", volatile)).not.toBe(
      canonicalizeBody("<r><a>2</a></r>", volatile),
    );
  });
});

describe("fingerprintRequest", () => {
  const url = "https://api.example.test/v1/items?b=2&a=1&ts=100";

  it("is deterministic and filesystem/human friendly", () => {
    const fp = fingerprintRequest("POST", url, '{"q":"alpha"}');
    expect(fp).toBe(fingerprintRequest("POST", url, '{"q":"alpha"}'));
    expect(fp).toMatch(/^post-api-example-test-v1-items-[0-9a-f]{12}$/);
  });

  it("ignores volatile params (default list) across re-runs", () => {
    const later = "https://api.example.test/v1/items?a=1&b=2&ts=999";
    expect(fingerprintRequest("GET", url, null)).toBe(fingerprintRequest("GET", later, null));
  });

  it("changes when method, path or body meaningfully change", () => {
    const base = fingerprintRequest("POST", url, '{"q":"alpha"}');
    expect(fingerprintRequest("GET", url, '{"q":"alpha"}')).not.toBe(base);
    expect(fingerprintRequest("POST", url, '{"q":"beta"}')).not.toBe(base);
    expect(
      fingerprintRequest("POST", "https://api.example.test/v2/items?a=1&b=2", '{"q":"alpha"}'),
    ).not.toBe(base);
  });

  it("honors extra volatile body keys from options", () => {
    const options = { volatileBodyKeys: ["attempt"] };
    expect(fingerprintRequest("POST", url, '{"attempt":1,"q":"alpha"}', options)).toBe(
      fingerprintRequest("POST", url, '{"attempt":2,"q":"alpha"}', options),
    );
  });
});
