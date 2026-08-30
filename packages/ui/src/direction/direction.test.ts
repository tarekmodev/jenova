import { describe, expect, it } from "vitest";
import { directionCacheOptions } from "./cache";
import { DEFAULT_LOCALE, directionForLocale, resolveDirection } from "./direction";

describe("direction resolution", () => {
  it("Arabic is the default locale and maps to rtl", () => {
    expect(DEFAULT_LOCALE).toBe("ar");
    expect(directionForLocale("ar")).toBe("rtl");
    expect(directionForLocale("en")).toBe("ltr");
  });

  it("explicit override wins (tooling only)", () => {
    expect(resolveDirection("ar")).toBe("rtl");
    expect(resolveDirection("ar", "ltr")).toBe("ltr");
    expect(resolveDirection("en", "rtl")).toBe("rtl");
  });
});

describe("directionCacheOptions", () => {
  it("keys never collide between directions", () => {
    expect(directionCacheOptions("ltr").key).not.toBe(directionCacheOptions("rtl").key);
  });

  it("rtl gets the stylis RTL plugin plus the restated prefixer", () => {
    const rtl = directionCacheOptions("rtl");
    expect(rtl.stylisPlugins).toHaveLength(2);
    const ltr = directionCacheOptions("ltr");
    expect(ltr.stylisPlugins).toBeUndefined();
  });

  it("prepends so app-level styles can override the kit", () => {
    expect(directionCacheOptions("rtl").prepend).toBe(true);
    expect(directionCacheOptions("ltr").prepend).toBe(true);
  });
});
