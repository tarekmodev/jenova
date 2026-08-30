import "reflect-metadata";
import { existsSync } from "node:fs";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./app.factory";
import { ApiConfigError } from "./config/config";

async function bootstrap(): Promise<void> {
  // Node 22 native .env loading — local dev only; staging/production inject
  // real environment variables from the deployment secret store.
  if (existsSync(".env")) {
    process.loadEnvFile();
  }

  const app = await NestFactory.create(AppModule);
  const config = configureApp(app);
  await app.listen(config.port);
}

bootstrap().catch((error: unknown) => {
  if (error instanceof ApiConfigError) {
    // Fail fast and legible: every missing/invalid variable, no stack noise.
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
