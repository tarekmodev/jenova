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

  it("documents delivery (M2 #100) is disabled when neither S3 nor SMTP is configured", () => {
    expect(loadWorkerConfig(VALID).documentsDelivery).toBeNull();
  });

  it("documents delivery: full S3 + SMTP blocks enable it with defaults", () => {
    const config = loadWorkerConfig({
      ...VALID,
      S3_ENDPOINT: "http://localhost:9000",
      S3_REGION: "me-south-1",
      S3_ACCESS_KEY_ID: "jenova",
      S3_SECRET_ACCESS_KEY: "jenova-minio",
      S3_BUCKET: "jenova-dev",
      S3_FORCE_PATH_STYLE: "true",
      SMTP_HOST: "localhost",
      SMTP_PORT: "1025",
      MAIL_FROM: "vouchers@jenova.local",
    });
    expect(config.documentsDelivery).toEqual({
      s3: {
        endpoint: "http://localhost:9000",
        region: "me-south-1",
        accessKeyId: "jenova",
        secretAccessKey: "jenova-minio",
        bucket: "jenova-dev",
        forcePathStyle: true,
      },
      smtp: { host: "localhost", port: 1025 },
      from: "vouchers@jenova.local",
      typstBin: "typst",
      intervalMs: 30_000,
    });
  });

  it("documents delivery: a partial block fails fast naming what is missing (all-or-nothing)", () => {
    const partial = { ...VALID, SMTP_HOST: "localhost" };
    expect(() => loadWorkerConfig(partial)).toThrow(WorkerConfigError);
    expect(() => loadWorkerConfig(partial)).toThrow(/MAIL_FROM[\s\S]*all-or-nothing/);
    expect(() => loadWorkerConfig(partial)).toThrow(/S3_ENDPOINT/);
  });
});
