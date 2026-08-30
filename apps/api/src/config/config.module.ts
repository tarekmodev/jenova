/**
 * Binds the loaded {@link ApiConfig} under API_CONFIG for every module that
 * needs configuration (gateway wiring, tenancy, offers). One factory, one
 * config instance — loading fails fast (ApiConfigError) before the app can
 * listen, and tests override the token with structural values.
 */

import { Module } from "@nestjs/common";
import { API_CONFIG, loadApiConfig } from "./config";

@Module({
  providers: [
    {
      provide: API_CONFIG,
      useFactory: () => loadApiConfig(process.env),
    },
  ],
  exports: [API_CONFIG],
})
export class ConfigModule {}
