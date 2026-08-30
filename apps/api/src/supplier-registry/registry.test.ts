import { describe, expect, it } from "vitest";
import {
  createSupplierRegistry,
  transportModeForEnv,
  UnknownSupplierError,
} from "./registry";

describe("supplier registry", () => {
  it("resolves the TBO hotel adapter by supplier code", () => {
    const registry = createSupplierRegistry({ mode: "replay" });
    const adapter = registry.hotelAdapter("tbo");
    expect(adapter.supplierCode).toBe("tbo");
    expect(adapter.vertical).toBe("hotel");
    expect(registry.hotelSupplierCodes).toEqual(["tbo"]);
  });

  it("throws UnknownSupplierError for an unregistered code", () => {
    const registry = createSupplierRegistry({ mode: "replay" });
    expect(() => registry.hotelAdapter("not-a-supplier")).toThrow(UnknownSupplierError);
    expect(() => registry.hotelVocabularyDrift("not-a-supplier")).toThrow(UnknownSupplierError);
  });

  it("exposes a per-supplier vocabulary-drift counter for the health board", () => {
    const registry = createSupplierRegistry({ mode: "replay" });
    expect(registry.hotelVocabularyDrift("tbo").size).toBe(0);
  });

  it("maps NODE_ENV to the transport mode per docs/09", () => {
    expect(transportModeForEnv("production")).toBe("live");
    expect(transportModeForEnv("development")).toBe("record");
    expect(transportModeForEnv("test")).toBe("replay");
  });
});
