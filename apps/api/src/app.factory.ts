/**
 * Shared app configuration — main.ts and the supertest e2e suite both go
 * through configureApp so production and test wiring cannot drift.
 */

import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { API_CONFIG, type ApiConfig } from "./config/config";

export const OPENAPI_PATH = "openapi";

export function configureApp(app: INestApplication): ApiConfig {
  const config = app.get<ApiConfig>(API_CONFIG);

  // Graceful shutdown: SIGTERM/SIGINT close the HTTP server and run module
  // lifecycle hooks (onModuleDestroy/onApplicationShutdown) before exit.
  app.enableShutdownHooks();

  // OpenAPI generation is wired for every environment; the interactive spec
  // is SERVED in development only.
  if (config.nodeEnv === "development") {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("Jenova API")
        .setDescription(
          "Multi-tenant travel platform gateway — every surface books through these services.",
        )
        .setVersion("0.0.0")
        .build(),
    );
    SwaggerModule.setup(OPENAPI_PATH, app, document);
  }

  return config;
}
