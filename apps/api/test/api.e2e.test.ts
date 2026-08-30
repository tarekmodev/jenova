import { Controller, Get, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { tenantId, type AppKey, type TenantId } from "@jenova/domain";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.factory";
import { API_CONFIG, type ApiConfig } from "../src/config/config";
import { RequiresApp } from "../src/gateway/decorators";
import { ENTITLEMENT_SOURCE, type EntitlementSource } from "../src/gateway/entitlement-source";
import { REQUEST_ID_HEADER } from "../src/gateway/request-context.middleware";
import { TENANT_DIRECTORY, type TenantDirectory } from "../src/gateway/tenant-directory";

// Structural config/values only — they mirror .env.example's local
// docker-compose defaults and exist to exercise the chain shape.
const testConfig: ApiConfig = Object.freeze({
  nodeEnv: "test",
  port: 0,
  controlPlaneDatabaseUrl: "postgres://jenova:jenova@localhost:5432/jenova_control_plane",
  redisUrl: "redis://localhost:6379",
});

const KNOWN_HOST = "tenant-one.example.test";
const KNOWN_TENANT = tenantId("tenant-one");

const testDirectory: TenantDirectory = {
  resolveByHost: (host) =>
    Promise.resolve(
      host === KNOWN_HOST ? { tenantId: KNOWN_TENANT, dbName: "tenant_one_db" } : null,
    ),
};

// The resolved tenant has b2b installed — and nothing else.
const testEntitlements: EntitlementSource = {
  isInstalled: (id: TenantId, appKey: AppKey) =>
    Promise.resolve(id === KNOWN_TENANT && appKey === "b2b"),
};

/** Demo surface for exercising @RequiresApp end to end (test-only). */
@Controller("demo")
class DemoController {
  @Get("b2b")
  @RequiresApp("b2b")
  b2bGated(): { ok: true } {
    return { ok: true };
  }

  @Get("crm")
  @RequiresApp("crm")
  crmGated(): { ok: true } {
    return { ok: true };
  }
}

describe("api e2e", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [DemoController],
    })
      .overrideProvider(API_CONFIG)
      .useValue(testConfig)
      .overrideProvider(TENANT_DIRECTORY)
      .useValue(testDirectory)
      .overrideProvider(ENTITLEMENT_SOURCE)
      .useValue(testEntitlements)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns liveness without touching dependencies", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(/[0-9a-f-]{36}/);
  });

  it("GET /ready reports ready with the M0 empty check set", async () => {
    const res = await request(app.getHttpServer()).get("/ready").expect(200);
    expect(res.body).toEqual({ status: "ready", checks: [] });
  });

  it("health probes bypass tenant resolution (no Host binding needed)", async () => {
    await request(app.getHttpServer())
      .get("/health")
      .set("Host", "unknown.example.test")
      .expect(200);
  });

  it("serves an app-gated route when tenant resolves and the app is installed", async () => {
    const res = await request(app.getHttpServer())
      .get("/demo/b2b")
      .set("Host", KNOWN_HOST)
      .expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns the 404 tenant_not_found envelope for an unknown host", async () => {
    const res = await request(app.getHttpServer())
      .get("/demo/b2b")
      .set("Host", "unknown.example.test")
      .expect(404);
    expect(res.body).toEqual({
      error: {
        code: "tenant_not_found",
        message: expect.stringContaining("unknown.example.test") as string,
        requestId: res.headers[REQUEST_ID_HEADER],
      },
    });
  });

  it("returns the 403 app_not_installed envelope for a missing entitlement", async () => {
    const res = await request(app.getHttpServer())
      .get("/demo/crm")
      .set("Host", KNOWN_HOST)
      .expect(403);
    expect(res.body).toEqual({
      error: {
        code: "app_not_installed",
        message: expect.stringContaining("crm") as string,
        requestId: res.headers[REQUEST_ID_HEADER],
      },
    });
  });

  it("wraps framework errors (unknown route) in the same envelope", async () => {
    const res = await request(app.getHttpServer())
      .get("/no-such-route")
      .set("Host", KNOWN_HOST)
      .expect(404);
    expect(res.body.error.code).toBe("not_found");
    expect(res.body.error.requestId).toBe(res.headers[REQUEST_ID_HEADER]);
  });
});
