/**
 * Root module of the Jenova api (docs/02-architecture.md: one deployable
 * NestJS process; engine modules attach here from M1).
 *
 * DI convention for this app: every injection uses an explicit @Inject(token).
 * We deliberately do NOT rely on emitDecoratorMetadata — vitest (esbuild) and
 * tsx cannot emit it, and explicit tokens keep test and runtime transforms
 * identical.
 */

import { Module } from "@nestjs/common";
import { API_CONFIG, loadApiConfig } from "./config/config";
import { GatewayModule } from "./gateway/gateway.module";
import { HealthController } from "./health/health.controller";
import { READINESS_CHECKS } from "./health/readiness";
import { HTTP_SERVER_HOOKS, noopHttpServerHooks } from "./observability/instrumentation";

@Module({
  imports: [GatewayModule],
  controllers: [HealthController],
  providers: [
    {
      provide: API_CONFIG,
      // Fails fast (ApiConfigError) before the app can listen.
      useFactory: () => loadApiConfig(process.env),
    },
    {
      // M0: empty set. Control-plane DB / redis checks register here once
      // their clients are wired (after #42).
      provide: READINESS_CHECKS,
      useValue: [],
    },
    {
      // OTel binds here when observability lands; seam only at M0.
      provide: HTTP_SERVER_HOOKS,
      useValue: noopHttpServerHooks,
    },
  ],
})
export class AppModule {}
