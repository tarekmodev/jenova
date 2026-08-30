import { describe, expect, it } from "vitest";
import { createJenovaTheme } from "./createJenovaTheme";
import { jenovaFontFamily, jenovaPalettes, jenovaShadows, jenovaShape } from "./tokens";

describe("createJenovaTheme", () => {
  it("carries the direction into the theme", () => {
    expect(createJenovaTheme({ direction: "rtl" }).direction).toBe("rtl");
    expect(createJenovaTheme({ direction: "ltr" }).direction).toBe("ltr");
  });

  it("defaults to the light token palette", () => {
    const theme = createJenovaTheme({ direction: "rtl" });
    expect(theme.palette.mode).toBe("light");
    expect(theme.palette.primary.main).toBe(jenovaPalettes.light.primary.main);
    expect(theme.palette.background.default).toBe(jenovaPalettes.light.background.default);
    expect(theme.palette.divider).toBe(jenovaPalettes.light.divider);
  });

  it("is dark-ready: dark mode swaps in the dark tokens", () => {
    const theme = createJenovaTheme({ direction: "rtl", mode: "dark" });
    expect(theme.palette.mode).toBe("dark");
    expect(theme.palette.background.default).toBe(jenovaPalettes.dark.background.default);
    expect(theme.palette.text.primary).toBe(jenovaPalettes.dark.text.primary);
  });

  it("uses the full 25-entry shadow scale", () => {
    const theme = createJenovaTheme({ direction: "ltr" });
    expect(theme.shadows).toHaveLength(25);
    expect(theme.shadows[0]).toBe("none");
    expect(jenovaShadows.light).toHaveLength(25);
    expect(jenovaShadows.dark).toHaveLength(25);
  });

  it("applies shape and the Arabic-capable font stack (overridable)", () => {
    const theme = createJenovaTheme({ direction: "rtl" });
    expect(theme.shape.borderRadius).toBe(jenovaShape.borderRadius);
    expect(theme.typography.fontFamily).toBe(jenovaFontFamily);
    expect(jenovaFontFamily).toContain("IBM Plex Sans Arabic");
    expect(jenovaFontFamily).toMatch(/sans-serif$/);

    const custom = createJenovaTheme({ direction: "rtl", fontFamily: "TenantFace, sans-serif" });
    expect(custom.typography.fontFamily).toBe("TenantFace, sans-serif");
  });

  it("never uppercases buttons — Arabic has no letter case", () => {
    const theme = createJenovaTheme({ direction: "rtl" });
    expect(theme.typography.button.textTransform).toBe("none");
  });
});
