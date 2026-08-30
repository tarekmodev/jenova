import { describe, expect, it } from "vitest";
import { loadWorkerConfig, WorkerConfigError } from "./config";

const VALID = {
  NODE_ENV: "test",
  REDIS_URL: "redis://localhost:6379",
  CONTROL_PLANE_DATABASE_URL: "postgres://jenova:jenova@localhost:5432/jenova_control_plane",
  JENOVA_TENANT_RUNTIME_DSN: "postgres://jenova_app:jenova_app@localhost:5432/postgres",
};

describe("worker config", () => {
  it("loads a valid environment with the sweep default", () => {
    const config = loadWorkerConfig(VALID);
    expect(config.nodeEnv).toBe("test");
    expect(config.pendingSweepIntervalMs).toBe(30_000);
  });

  it("FAIL-CLOSED: unset NODE_ENV resolves to production, never development", () => {
    const withoutNodeEnv = {
      REDIS_URL: VALID.REDIS_URL,
      CONTROL_PLANE_DATABASE_URL: VALID.CONTROL_PLANE_DATABASE_URL,
      JENOVA_TENANT_RUNTIME_DSN: VALID.JENOVA_TENANT_RUNTIME_DSN,
    };
    expect(loadWorkerConfig(withoutNodeEnv).nodeEnv).toBe("production");
  });

  it("honors an explicit sweep interval", () => {
    const config = loadWorkerConfig({ ...VALID, WORKER_PENDING_SWEEP_INTERVAL_MS: "5000" });
    expect(config.pendingSweepIntervalMs).toBe(5_000);
  });

  it("fails fast listing every missing variable", () => {
    expect(() => loadWorkerConfig({})).toThrow(WorkerConfigError);
    expect(() => loadWorkerConfig({})).toThrow(/REDIS_URL/);
    expect(() => loadWorkerConfig({})).toThrow(/JENOVA_TENANT_RUNTIME_DSN/);
  });

  it("rejects a sub-second sweep interval (supplier courtesy floor)", () => {
    expect(() => loadWorkerConfig({ ...VALID, WORKER_PENDING_SWEEP_INTERVAL_MS: "10" })).toThrow(
      WorkerConfigError,
    );
  });
});
