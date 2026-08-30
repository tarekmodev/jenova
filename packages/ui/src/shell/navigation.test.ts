import { describe, expect, it } from "vitest";
import { filterNavByEntitlements, navBranchContains, type NavItem } from "./navigation";

// Structural synthetic values only — ids/flags, no business data (CLAUDE.md rule 5).
const tree: readonly NavItem[] = [
  { id: "home", label: "home" },
  { id: "b2b", label: "b2b", entitlement: "b2b" },
  {
    id: "finance",
    label: "finance",
    entitlement: "finance",
    children: [
      { id: "ledger", label: "ledger" },
      { id: "invoices", label: "invoices", entitlement: "fiscal" },
    ],
  },
  {
    id: "group",
    label: "group",
    children: [
      { id: "child-a", label: "child-a", entitlement: "app-a" },
      { id: "child-b", label: "child-b", entitlement: "app-b" },
    ],
  },
];

describe("filterNavByEntitlements", () => {
  it("no entitlement list = no filtering (platform-admin view)", () => {
    expect(filterNavByEntitlements(tree)).toHaveLength(4);
  });

  it("hides flagged items the tenant is not entitled to", () => {
    const items = filterNavByEntitlements(tree, ["b2b"]);
    expect(items.map((item) => item.id)).toEqual(["home", "b2b"]);
  });

  it("filters recursively and keeps entitled branches", () => {
    const items = filterNavByEntitlements(tree, ["finance"]);
    expect(items.map((item) => item.id)).toEqual(["home", "finance"]);
    expect(items[1]?.children?.map((child) => child.id)).toEqual(["ledger"]);
  });

  it("drops link-less branches whose children all filtered out", () => {
    const items = filterNavByEntitlements(tree, ["app-b"]);
    const group = items.find((item) => item.id === "group");
    expect(group?.children?.map((child) => child.id)).toEqual(["child-b"]);
    expect(filterNavByEntitlements(tree, []).map((item) => item.id)).toEqual(["home"]);
  });
});

describe("navBranchContains", () => {
  it("finds the selected id at any depth", () => {
    const finance = tree[2] as NavItem;
    expect(navBranchContains(finance, "invoices")).toBe(true);
    expect(navBranchContains(finance, "finance")).toBe(true);
    expect(navBranchContains(finance, "home")).toBe(false);
    expect(navBranchContains(finance, undefined)).toBe(false);
  });
});
