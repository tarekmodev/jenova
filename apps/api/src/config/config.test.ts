import { describe, expect, it } from "vitest";
import { ApiConfigError, loadApiConfig } from "./config";

// Structural values only — they mirror the local docker-compose defaults that
// .env.example (the authoritative variable list) documents.
const validEnv = {
  CONTROL_PLANE_DATABASE_URL: "postgres://jenova:jenova@localhost:5432/jenova_control_plane",
  REDIS_URL: "redis://localhost:6379",
  JENOVA_TENANT_RUNTIME_DSN: "postgres://jenova_app:jenova_app@localhost:5432/postgres",
  OFFER_SIGNING_KEY: "dev-only-offer-signing-key-change-me-0000",
};

describe("loadApiConfig", () => {
  it("parses a minimal valid environment and applies defaults", () => {
    const config = loadApiConfig(validEnv);
    expect(config).toEqual({
      nodeEnv: "development",
      port: 3000,
      controlPlaneDatabaseUrl: validEnv.CONTROL_PLANE_DATABASE_URL,
      redisUrl: validEnv.REDIS_URL,
      tenantRuntimeDsn: validEnv.JENOVA_TENANT_RUNTIME_DSN,
      offerSigningKey: validEnv.OFFER_SIGNING_KEY,
      hotelSearchBudgetMs: 8_000,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("honors explicit NODE_ENV and API_PORT", () => {
    const config = loadApiConfig({ ...validEnv, NODE_ENV: "production", API_PORT: "8080" });
    expect(config.nodeEnv).toBe("production");
    expect(config.port).toBe(8080);
  });

  it("fails fast when a required variable is missing, naming it", () => {
    const withoutRedis = { CONTROL_PLANE_DATABASE_URL: validEnv.CONTROL_PLANE_DATABASE_URL };
    expect(() => loadApiConfig(withoutRedis)).toThrowError(ApiConfigError);
    expect(() => loadApiConfig(withoutRedis)).toThrowError(/REDIS_URL/);
  });

  it("reports every problem at once", () => {
    expect(() => loadApiConfig({})).toThrowError(
      /CONTROL_PLANE_DATABASE_URL[\s\S]*REDIS_URL/,
    );
  });

  it("rejects a non-URL control-plane connection string", () => {
    expect(() =>
      loadApiConfig({ ...validEnv, CONTROL_PLANE_DATABASE_URL: "not a url" }),
    ).toThrowError(ApiConfigError);
  });

  it("rejects an out-of-range or non-numeric port", () => {
    expect(() => loadApiConfig({ ...validEnv, API_PORT: "0" })).toThrowError(ApiConfigError);
    expect(() => loadApiConfig({ ...validEnv, API_PORT: "70000" })).toThrowError(ApiConfigError);
    expect(() => loadApiConfig({ ...validEnv, API_PORT: "http" })).toThrowError(ApiConfigError);
  });

  it("rejects an offer signing key shorter than 32 characters", () => {
    expect(() => loadApiConfig({ ...validEnv, OFFER_SIGNING_KEY: "short" })).toThrowError(
      ApiConfigError,
    );
    expect(() => loadApiConfig({ ...validEnv, OFFER_SIGNING_KEY: "short" })).toThrowError(
      /OFFER_SIGNING_KEY/,
    );
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => loadApiConfig({ ...validEnv, NODE_ENV: "staging" })).toThrowError(
      ApiConfigError,
    );
  });

  it("honors HOTEL_SEARCH_BUDGET_MS within bounds and rejects it outside them", () => {
    expect(loadApiConfig({ ...validEnv, HOTEL_SEARCH_BUDGET_MS: "5000" }).hotelSearchBudgetMs).toBe(
      5_000,
    );
    expect(() => loadApiConfig({ ...validEnv, HOTEL_SEARCH_BUDGET_MS: "100" })).toThrowError(
      /HOTEL_SEARCH_BUDGET_MS/,
    );
    expect(() => loadApiConfig({ ...validEnv, HOTEL_SEARCH_BUDGET_MS: "60000" })).toThrowError(
      ApiConfigError,
    );
  });
});
