/**
 * Navigation model + entitlement filtering (pure — unit-tested).
 *
 * Apps are entitlements, not codebases (CLAUDE.md rule 3): the sidebar for
 * a tenant renders whatever its entitlement flags allow, from one shared
 * item tree. Filtering lives here so every dashboard-class app hides
 * un-entitled sections identically.
 */

import type { ReactNode } from "react";

export interface NavItem {
  readonly id: string;
  /** Display label — localized by the app before it reaches the kit. */
  readonly label: string;
  readonly icon?: ReactNode;
  readonly href?: string;
  /**
   * Entitlement flag (AppKey or finer-grained feature) required to see the
   * item. Absent = always visible.
   */
  readonly entitlement?: string;
  readonly disabled?: boolean;
  readonly children?: readonly NavItem[];
}

/**
 * Drops items whose `entitlement` is not in `entitlements`, recursively.
 * `entitlements === undefined` means "do not filter" (platform-admin
 * surfaces); an empty array means "no entitlements" and hides every
 * flagged item. Branch items (children, no own href) disappear when all
 * their children are filtered out.
 */
export function filterNavByEntitlements(
  items: readonly NavItem[],
  entitlements?: readonly string[],
): NavItem[] {
  if (entitlements === undefined) return [...items];
  const allowed = new Set(entitlements);
  const result: NavItem[] = [];
  for (const item of items) {
    if (item.entitlement !== undefined && !allowed.has(item.entitlement)) continue;
    if (item.children === undefined) {
      result.push(item);
      continue;
    }
    const children = filterNavByEntitlements(item.children, entitlements);
    if (children.length === 0 && item.href === undefined) continue;
    result.push({ ...item, children });
  }
  return result;
}

/** True when `item` or any descendant is the selected one (branch auto-expand). */
export function navBranchContains(item: NavItem, selectedId: string | undefined): boolean {
  if (selectedId === undefined) return false;
  if (item.id === selectedId) return true;
  return (item.children ?? []).some((child) => navBranchContains(child, selectedId));
}
