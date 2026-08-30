import { Module } from "@nestjs/common";
import { NODE_ENVS, type NodeEnv } from "../config/config";
import { createSupplierRegistry, transportModeForEnv } from "./registry";

/** Nest injection token for the {@link SupplierRegistry}. */
export const SUPPLIER_REGISTRY = Symbol("jenova.supplier-registry");

function nodeEnv(value: string | undefined): NodeEnv {
  return (NODE_ENVS as readonly string[]).includes(value ?? "")
    ? (value as NodeEnv)
    : "development";
}

/**
 * Provides the process-wide supplier registry. Engine modules (hotel-search,
 * hotel-booking) inject SUPPLIER_REGISTRY — they never import adapter
 * packages themselves (CLAUDE.md rule 4). Transport mode follows NODE_ENV
 * (docs/09-testing.md): production=live, development=record, test=replay.
 */
@Module({
  providers: [
    {
      provide: SUPPLIER_REGISTRY,
      useFactory: () =>
        createSupplierRegistry({ mode: transportModeForEnv(nodeEnv(process.env["NODE_ENV"])) }),
    },
  ],
  exports: [SUPPLIER_REGISTRY],
})
export class SupplierRegistryModule {}
