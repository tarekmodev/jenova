/**
 * RTL/LTR screenshot sweep — the M2 "RTL e2e screenshot checks".
 *
 * Every story in the static Storybook build renders twice: Arabic (rtl)
 * and English (ltr). Each render must mount without page errors, carry
 * the expected document direction (proves the DirectionProvider +
 * emotion RTL cache end to end), and is captured to
 * screenshots/__screenshots__/<story>--<dir>.png (CI uploads them as
 * the review artifact). The build happens ONCE; both directions snapshot
 * from it.
 */

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const indexJsonPath = join(here, "..", "storybook-static", "index.json");

interface StoryIndexEntry {
  readonly id: string;
  readonly type: string;
}

function loadStoryIds(): readonly string[] {
  let raw: string;
  try {
    raw = readFileSync(indexJsonPath, "utf8");
  } catch {
    throw new Error(`Missing ${indexJsonPath} — run \`pnpm build-storybook\` first.`);
  }
  const index = JSON.parse(raw) as { entries: Record<string, StoryIndexEntry> };
  const ids = Object.values(index.entries)
    .filter((entry) => entry.type === "story")
    .map((entry) => entry.id)
    .sort();
  if (ids.length === 0) throw new Error("Storybook index contains no stories");
  return ids;
}

const RUNS = [
  { locale: "ar", dir: "rtl" },
  { locale: "en", dir: "ltr" },
] as const;

for (const storyId of loadStoryIds()) {
  for (const run of RUNS) {
    test(`${storyId} [${run.locale}/${run.dir}]`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(String(error)));

      await page.goto(
        `/iframe.html?viewMode=story&id=${storyId}&globals=locale:${run.locale};direction:auto`,
        { waitUntil: "networkidle" },
      );

      // A crashed story swaps in Storybook's error display.
      await expect(page.locator("body")).not.toHaveClass(/sb-show-errordisplay/);
      // Portal-only stories (dialogs) render outside #storybook-root.
      await expect(page.locator("#storybook-root > *, .MuiModal-root").first()).toBeAttached();

      // Direction must be applied by the provider, end to end.
      await expect(page.locator("html")).toHaveAttribute("dir", run.dir);
      await expect(page.locator("html")).toHaveAttribute("lang", run.locale);

      await page.screenshot({
        path: join(here, "__screenshots__", `${storyId}--${run.dir}.png`),
        fullPage: true,
      });

      expect(pageErrors).toEqual([]);
    });
  }
}
