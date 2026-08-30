// Codec mechanics proven on trivial structural values only — nothing here
// imitates any supplier API shape (CLAUDE.md rule 5).
import { describe, expect, it } from "vitest";
import { isSupplierError } from "@jenova/domain";
import { z } from "zod";
import { parseJsonWith, serializeJson } from "./json";

function capture(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

describe("serializeJson", () => {
  it("round-trips a trivial object", () => {
    expect(serializeJson({ ok: true })).toBe('{"ok":true}');
  });

  it("maps unserializable payloads to invalid_request", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    const error = capture(() => serializeJson(circular));
    expect(isSupplierError(error) && error.kind).toBe("invalid_request");
  });

  it("maps an undefined root to invalid_request", () => {
    const error = capture(() => serializeJson(undefined));
    expect(isSupplierError(error) && error.kind).toBe("invalid_request");
  });
});

describe("parseJsonWith", () => {
  const schema = z.object({ ok: z.boolean() });

  it("returns the schema's typed output", () => {
    const parsed = parseJsonWith(schema, '{"ok":true}');
    expect(parsed.ok).toBe(true);
  });

  it("maps malformed JSON to invalid_request naming the supplier", () => {
    const error = capture(() => parseJsonWith(schema, "not json", { supplierCode: "structural" }));
    expect(isSupplierError(error) && error.kind).toBe("invalid_request");
    expect(isSupplierError(error) ? error.message : "").toContain("structural");
  });

  it("maps schema violations to invalid_request naming each offending path", () => {
    const error = capture(() => parseJsonWith(schema, '{"ok":"yes"}'));
    expect(isSupplierError(error) && error.kind).toBe("invalid_request");
    expect(isSupplierError(error) ? error.message : "").toContain("ok");
  });
});
