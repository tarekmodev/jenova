/**
 * Pricing engine module (M1, issues #62/#63): most-specific-wins MarkupRule
 * resolution as a pure function library, wrapped here with rule loading.
 *
 * Every surface prices through PRICING_SERVICE — per-surface differences
 * (channel, buyer, settlement currency, VAT treatment) are context
 * parameters, never forks (CLAUDE.md rule 2).
 */

import { Module } from "@nestjs/common";
import {
  InMemoryMarkupRuleSource,
  MARKUP_RULE_SOURCE,
  PRICING_SERVICE,
  PricingService,
  type MarkupRuleSource,
} from "./pricing.service";

@Module({
  providers: [
    // Drizzle-backed source (tenant resolver → markup_rule) binds here once
    // the api's tenant-db wiring lands; the service and consumers stay put.
    { provide: MARKUP_RULE_SOURCE, useClass: InMemoryMarkupRuleSource },
    {
      provide: PRICING_SERVICE,
      inject: [MARKUP_RULE_SOURCE],
      useFactory: (rules: MarkupRuleSource) => new PricingService(rules),
    },
  ],
  exports: [MARKUP_RULE_SOURCE, PRICING_SERVICE],
})
export class PricingModule {}
