import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.factory";
import { API_CONFIG, type ApiConfig } from "../src/config/config";

// Structural config — mirrors .env.example's local docker-compose defaults.
const testConfig: ApiConfig = Object.freeze({
  nodeEnv: "test",
  port: 0,
  controlPlaneDatabaseUrl: "postgres://jenova:jenova@localhost:5432/jenova_control_plane",
  redisUrl: "redis://localhost:6379",
});

describe("api e2e", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_CONFIG)
      .useValue(testConfig)
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
  });

  it("GET /ready reports ready with the M0 empty check set", async () => {
    const res = await request(app.getHttpServer()).get("/ready").expect(200);
    expect(res.body).toEqual({ status: "ready", checks: [] });
  });
});
