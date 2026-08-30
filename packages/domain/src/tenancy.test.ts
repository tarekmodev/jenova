import { describe, expect, it } from "vitest";
import {
  APP_KEYS,
  InvalidIdError,
  isAppKey,
  isLocale,
  isSalesChannel,
  isVertical,
  LOCALES,
  SALES_CHANNELS,
  subTenantId,
  tenantId,
  VERTICALS,
  type AppKey,
  type Locale,
  type SalesChannel,
  type SubTenantId,
  type TenantId,
  type Vertical,
} from "./tenancy";

describe("branded ids", () => {
  it("constructs branded ids from non-empty strings", () => {
    const t: TenantId = tenantId("tnt_01");
    const s: SubTenantId = subTenantId("agc_07");
    expect(t).toBe("tnt_01");
    expect(s).toBe("agc_07");
  });

  it("rejects empty and whitespace-padded ids", () => {
    for (const bad of ["", " ", " x", "x ", "\tx"]) {
      expect(() => tenantId(bad)).toThrow(InvalidIdError);
      expect(() => subTenantId(bad)).toThrow(InvalidIdError);
    }
  });

  it("brands are distinct at the type level", () => {
    // @ts-expect-error a raw string is not a TenantId
    const raw: TenantId = "tnt_01";
    // @ts-expect-error a SubTenantId is not a TenantId
    const crossed: TenantId = subTenantId("agc_07");
    expect(raw).toBeDefined();
    expect(crossed).toBeDefined();
  });
});

describe("platform enums", () => {
  it("AppKey covers exactly the eight installable apps", () => {
    expect(APP_KEYS).toEqual([
      "b2b",
      "corporate",
      "finance",
      "api_access",
      "storefront",
      "crm",
      "desk",
      "contracting",
    ]);
  });

  it("Vertical covers hotel/air/ground/package", () => {
    expect(VERTICALS).toEqual(["hotel", "air", "ground", "package"]);
  });

  it("Locale is Arabic-first ar/en", () => {
    expect(LOCALES).toEqual(["ar", "en"]);
  });

  it("SalesChannel covers every booking surface", () => {
    expect(SALES_CHANNELS).toEqual(["b2b", "corporate", "b2c", "api", "internal"]);
  });

  it("type guards accept members and reject strangers", () => {
    for (const k of APP_KEYS) expect(isAppKey(k)).toBe(true);
    for (const v of VERTICALS) expect(isVertical(v)).toBe(true);
    for (const l of LOCALES) expect(isLocale(l)).toBe(true);
    for (const c of SALES_CHANNELS) expect(isSalesChannel(c)).toBe(true);
    for (const bad of ["", "B2B", "hotels", "fr", "b2c ", "unknown"]) {
      expect(isAppKey(bad)).toBe(false);
      expect(isVertical(bad)).toBe(false);
      expect(isLocale(bad)).toBe(false);
      expect(isSalesChannel(bad)).toBe(false);
    }
  });

  it("guards narrow to the union types", () => {
    const value = "hotel" as string;
    if (isVertical(value)) {
      const v: Vertical = value;
      expect(v).toBe("hotel");
    }
    const app = "crm" as string;
    if (isAppKey(app)) {
      const a: AppKey = app;
      expect(a).toBe("crm");
    }
    const loc = "ar" as string;
    if (isLocale(loc)) {
      const l: Locale = loc;
      expect(l).toBe("ar");
    }
    const ch = "b2b" as string;
    if (isSalesChannel(ch)) {
      const c: SalesChannel = ch;
      expect(c).toBe("b2b");
    }
  });
});
