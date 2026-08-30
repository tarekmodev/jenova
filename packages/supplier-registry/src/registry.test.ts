import { describe, expect, it } from "vitest";
import {
  createSupplierRegistry,
  EnvSupplierCredentialsSource,
  resolveNodeEnv,
  transportModeForEnv,
} from "./index";

describe("supplier registry", () => {
  it("resolves the TBO hotel adapter by supplier code", () => {
    const registry = createSupplierRegistry({ mode: "replay" });
    const adapter = registry.hotelAdapter("tbo");
    expect(adapter?.supplierCode).toBe("tbo");
    expect(adapter?.vertical).toBe("hotel");
    expect(registry.hotelSupplierCodes).toEqual(["tbo"]);
  });

  it("answers null for an unregistered code — unavailability, never a crash", () => {
    const registry = createSupplierRegistry({ mode: "replay" });
    expect(registry.hotelAdapter("not-a-supplier")).toBeNull();
    expect(registry.hotelVocabularyDrift("not-a-supplier")).toBeNull();
  });

  it("exposes a per-supplier vocabulary-drift counter for the health board", () => {
    const registry = createSupplierRegistry({ mode: "replay" });
    expect(registry.hotelVocabularyDrift("tbo")?.size).toBe(0);
  });

  it("maps NODE_ENV to the transport mode per docs/09", () => {
    expect(transportModeForEnv("production")).toBe("live");
    expect(transportModeForEnv("development")).toBe("record");
    expect(transportModeForEnv("test")).toBe("replay");
  });

  it("FAIL-CLOSED: unset or typo'd NODE_ENV resolves to production", () => {
    expect(resolveNodeEnv({})).toBe("production");
    expect(resolveNodeEnv({ NODE_ENV: "" })).toBe("production");
    expect(resolveNodeEnv({ NODE_ENV: "prod" })).toBe("production");
    expect(resolveNodeEnv({ NODE_ENV: "development" })).toBe("development");
    expect(resolveNodeEnv({ NODE_ENV: "test" })).toBe("test");
  });

  it("env credentials work ONLY under an explicit NODE_ENV=development", async () => {
    const tenant = "00000000-0000-0000-0000-000000000000" as never;
    // Unset, production and test all refuse — never dev credentials by default.
    for (const env of [{}, { NODE_ENV: "production" }, { NODE_ENV: "test" }]) {
      const source = new EnvSupplierCredentialsSource(env);
      await expect(source.credentialsFor(tenant, "tbo")).rejects.toThrow(
        /development-only seam/,
      );
    }
    // Explicit development with the block filled resolves (structural values;
    // replay never reads them — real values come from the developer's .env).
    const dev = new EnvSupplierCredentialsSource({
      NODE_ENV: "development",
      TBO_HOTEL_API_URL: "https://api.tbotechnology.in/TBOHolidays_HotelAPI",
      TBO_HOTEL_USERNAME: "dev",
      TBO_HOTEL_PASSWORD: "dev",
    });
    await expect(dev.credentialsFor(tenant, "tbo")).resolves.toMatchObject({
      supplierCode: "tbo",
      environment: "sandbox",
    });
  });
});
