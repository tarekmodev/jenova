/**
 * The dashboard's app manifest — ONE tree drives the sidebar AND the route
 * guard (issue #90). Apps are entitlements, not codebases (CLAUDE.md
 * rule 3): every installable app is a manifest entry with its entitlement
 * flag; the core workspace + settings carry none and every tenant gets
 * them. Uninstalled apps are absent from nav (filterNavByEntitlements)
 * and refused at their routes (`pathAllowed` → ForbiddenState) — and the
 * api independently refuses them at the gateway.
 *
 * Pure module: no React, no next — unit-tested directly.
 */

import { APP_KEYS, isAppKey, type AppKey } from "@jenova/domain";

export interface ManifestEntry {
  readonly id: string;
  /** i18n key under the `nav` namespace — the shell localizes labels. */
  readonly labelKey: string;
  readonly href: string;
  /** AppKey required to see AND visit this entry; absent = core. */
  readonly entitlement?: AppKey;
}

export interface ManifestSection {
  readonly id: string;
  /** i18n key under `nav.sections`. */
  readonly titleKey: string;
  readonly items: readonly ManifestEntry[];
}

export const DASHBOARD_MANIFEST: readonly ManifestSection[] = [
  {
    id: "workspace",
    titleKey: "workspace",
    items: [
      { id: "bookings", labelKey: "bookings", href: "/workspace/bookings" },
      { id: "queue", labelKey: "queue", href: "/workspace/queue" },
      { id: "search", labelKey: "searchConsole", href: "/workspace/search" },
    ],
  },
  {
    id: "apps",
    titleKey: "apps",
    items: APP_KEYS.map((key) => ({
      id: `app-${key}`,
      labelKey: `app.${key}`,
      href: `/apps/${key}`,
      entitlement: key,
    })),
  },
  {
    id: "settings",
    titleKey: "settings",
    items: [
      { id: "settings-users", labelKey: "users", href: "/settings/users" },
      { id: "settings-suppliers", labelKey: "suppliers", href: "/settings/suppliers" },
      { id: "settings-branding", labelKey: "branding", href: "/settings/branding" },
      { id: "settings-account", labelKey: "account", href: "/settings/account" },
    ],
  },
];

/** `/apps/<key>[/...]` → the AppKey the path belongs to; null elsewhere. */
export function appKeyForPath(pathname: string): AppKey | null {
  const match = /^\/apps\/([^/]+)/.exec(pathname);
  const candidate = match?.[1];
  if (candidate === undefined) return null;
  return isAppKey(candidate) ? candidate : null;
}

/**
 * Route guard: core paths are always allowed; an app path demands its
 * entitlement. An /apps/* path that is not a known AppKey is NOT allowed —
 * unknown never opens anything.
 */
export function pathAllowed(pathname: string, installed: readonly AppKey[]): boolean {
  if (pathname.startsWith("/apps/")) {
    const key = appKeyForPath(pathname);
    return key !== null && installed.includes(key);
  }
  return true;
}

/** Longest-href-prefix match — which nav entry a pathname lights up. */
export function selectedNavId(pathname: string): string | undefined {
  let best: ManifestEntry | undefined;
  for (const section of DASHBOARD_MANIFEST) {
    for (const item of section.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        if (best === undefined || item.href.length > best.href.length) {
          best = item;
        }
      }
    }
  }
  return best?.id;
}
