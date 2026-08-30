import { money, tenantId } from "@jenova/domain";
import { describe, expect, it } from "vitest";
import { InMemoryMarkupRuleSource, PricingService } from "./pricing.service";
import type { PricingContext, PricingRule } from "./rules";

const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");

const CONTEXT: PricingContext = {
  subTenantId: null,
  channel: "b2b",
  vertical: "hotel",
  supplierCode: "sup-a",
  destination: null,
  travelDate: null,
  nights: null,
  paxCount: null,
};

const TENANT_A_RULE: PricingRule = {
  id: "rule-a",
  priority: 0,
  agencyId: null,
  channel: null,
  vertical: null,
  supplierCode: null,
  destination: null,
  travelFrom: null,
  travelTo: null,
  valueType: "percent",
  value: 1000n,
  currency: null,
  commissionSplitBps: null,
  active: true,
};

describe("PricingService", () => {
  it("loads rules for the explicit tenant scope only", async () => {
    const source = new InMemoryMarkupRuleSource();
    source.setRules(TENANT_A, [TENANT_A_RULE]);
    const service = new PricingService(source);

    const options = { vat: { mode: "exempt", rateBps: 0 } } as const;
    const priced = await service.price(TENANT_A, money(10_000, "SAR"), CONTEXT, options);
    expect(priced.sell).toEqual(money(11_000, "SAR"));
    expect(priced.firedRuleId).toBe("rule-a");

    // Another tenant sees none of tenant A's rules — no markup fires.
    const other = await service.price(TENANT_B, money(10_000, "SAR"), CONTEXT, options);
    expect(other.sell).toEqual(money(10_000, "SAR"));
    expect(other.firedRuleId).toBeNull();
  });
});
