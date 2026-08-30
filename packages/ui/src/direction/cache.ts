/**
 * Per-direction emotion cache options.
 *
 * RTL styling is done ONCE, at the cache layer: `stylis-plugin-rtl` flips
 * every physical property MUI internals emit, so components above it stay
 * direction-agnostic (logical properties only). One cache per direction —
 * the key embeds the direction so ltr/rtl style islands never collide.
 *
 * These OPTIONS (not a cache instance) are the shared contract between the
 * client-side provider (DirectionProvider) and the Next.js App Router SSR
 * provider (src/next), which must build its cache per request.
 */

import type { Options as EmotionCacheOptions } from "@emotion/cache";
import createCache, { type EmotionCache } from "@emotion/cache";
import { prefixer } from "stylis";
import rtlPlugin from "stylis-plugin-rtl";
import type { UiDirection } from "./direction";

export function directionCacheOptions(direction: UiDirection): EmotionCacheOptions {
  if (direction === "rtl") {
    return {
      key: "jenova-rtl",
      // Passing stylisPlugins REPLACES emotion's default list, so the
      // vendor prefixer must be restated ahead of the RTL flip.
      stylisPlugins: [prefixer, rtlPlugin],
      prepend: true,
    };
  }
  return { key: "jenova-ltr", prepend: true };
}

export function createDirectionCache(direction: UiDirection): EmotionCache {
  return createCache(directionCacheOptions(direction));
}
