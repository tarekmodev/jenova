/**
 * Nav filtering + route guarding (issue #90) — the acceptance rule under
 * test: an uninstalled app is absent from navigation AND refused at its
 * route, from the SAME manifest.
 */

import { describe, expect, it } from "vitest";
import { APP_KEYS } from "@jenova/domain";
import { filterNavByEntitlements, type NavItem } from "@jenova/ui";
import {
  appKeyForPath,
  DASHBOARD_MANIFEST,
  pathAllowed,
  selectedNavId,
  type ManifestSection,
} from "./manifest";

function navItemsOf(section: ManifestSection): NavItem[] {
  return section.items.map((item) => ({
    id: item.id,
    label: item.labelKey,
    href: item.href,
    ...(item.entitlement !== undefined ? { entitlement: item.entitlement } : {}),
  }));
}

function sectionById(id: string): ManifestSection {
  const section = DASHBOARD_MANIFEST.find((candidate) => candidate.id === id);
  if (section === undefined) throw new Error(`no manifest section '${id}'`);
  return section;
}

describe("DASHBOARD_MANIFEST", () => {
  it("lists every installable AppKey exactly once, entitlement-flagged", () => {
    const apps = sectionById("apps");
    expect(apps.items.map((item) => item.entitlement)).toEqual([...APP_KEYS]);
    expect(new Set(apps.items.map((item) => item.id)).size).toBe(APP_KEYS.length);
  });

  it("core workspace and settings carry NO entitlement — every tenant gets them", () => {
    for (const section of [sectionById("workspace"), sectionById("settings")]) {
      for (const item of section.items) {
        expect(item.entitlement).toBeUndefined();
      }
    }
  });
});

describe("nav filtering (via the ui kit's filterNavByEntitlements)", () => {
  it("drops uninstalled apps and keeps installed ones", () => {
    const items = navItemsOf(sectionById("apps"));
    const visible = filterNavByEntitlements(items, ["b2b", "finance"]);
    expect(visible.map((item) => item.id)).toEqual(["app-b2b", "app-finance"]);
  });

  it("hides the whole apps section for a tenant with no installations", () => {
    const items = navItemsOf(sectionById("apps"));
    expect(filterNavByEntitlements(items, [])).toEqual([]);
  });

  it("never filters core sections", () => {
    const items = navItemsOf(sectionById("workspace"));
    expect(filterNavByEntitlements(items, []).length).toBe(items.length);
  });
});

describe("appKeyForPath", () => {
  it("extracts the app key from app routes, at any depth", () => {
    expect(appKeyForPath("/apps/b2b")).toBe("b2b");
    expect(appKeyForPath("/apps/finance/reports")).toBe("finance");
  });

  it("returns null off app routes and for unknown keys", () => {
    expect(appKeyForPath("/workspace/bookings")).toBeNull();
    expect(appKeyForPath("/apps/not-an-app")).toBeNull();
    expect(appKeyForPath("/")).toBeNull();
  });
});

describe("pathAllowed (route guard)", () => {
  it("always allows core workspace and settings", () => {
    expect(pathAllowed("/workspace/bookings", [])).toBe(true);
    expect(pathAllowed("/settings/users", [])).toBe(true);
  });

  it("allows an app route only when its app is installed", () => {
    expect(pathAllowed("/apps/b2b", ["b2b"])).toBe(true);
    expect(pathAllowed("/apps/b2b/agencies", ["b2b"])).toBe(true);
    expect(pathAllowed("/apps/b2b", [])).toBe(false);
    expect(pathAllowed("/apps/finance", ["b2b"])).toBe(false);
  });

  it("refuses unknown /apps/* segments regardless of entitlements", () => {
    expect(pathAllowed("/apps/unknown", [...APP_KEYS])).toBe(false);
  });
});

describe("selectedNavId", () => {
  it("matches exact and nested paths, preferring the longest prefix", () => {
    expect(selectedNavId("/workspace/bookings")).toBe("bookings");
    expect(selectedNavId("/workspace/bookings/abc-123")).toBe("bookings");
    expect(selectedNavId("/settings/account")).toBe("settings-account");
    expect(selectedNavId("/apps/crm")).toBe("app-crm");
  });

  it("returns undefined for unmapped paths", () => {
    expect(selectedNavId("/nowhere")).toBeUndefined();
  });
});
