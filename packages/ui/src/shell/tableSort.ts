/**
 * DataTable sorting (pure — unit-tested).
 *
 * Client-side sorting only applies when a column provides `sortValue`;
 * columns without it emit `onSortChange` for the server to handle.
 */

export type SortDirection = "asc" | "desc";

export interface TableSortState {
  readonly columnId: string;
  readonly direction: SortDirection;
}

/** Column click cycle: unsorted → asc → desc → asc … */
export function toggleSort(current: TableSortState | null, columnId: string): TableSortState {
  if (current === null || current.columnId !== columnId) {
    return { columnId, direction: "asc" };
  }
  return { columnId, direction: current.direction === "asc" ? "desc" : "asc" };
}

/**
 * Stable sort by `sortValue`. Numbers compare numerically; strings via
 * `Intl.Collator` for the given locale (Arabic labels sort correctly).
 * Missing values (null/undefined) sort last regardless of direction.
 */
export function sortRows<Row>(
  rows: readonly Row[],
  sortValue: (row: Row) => string | number | null | undefined,
  direction: SortDirection,
  locale?: string,
): Row[] {
  const collator = new Intl.Collator(locale ?? undefined, { numeric: true });
  const sign = direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row) }))
    .sort((a, b) => {
      const aMissing = a.value === null || a.value === undefined;
      const bMissing = b.value === null || b.value === undefined;
      if (aMissing || bMissing) {
        if (aMissing && bMissing) return a.index - b.index;
        return aMissing ? 1 : -1; // missing last, independent of direction
      }
      const cmp = compareValues(a.value as string | number, b.value as string | number, collator);
      if (cmp !== 0) return cmp * sign;
      return a.index - b.index; // stability
    })
    .map((entry) => entry.row);
}

function compareValues(a: string | number, b: string | number, collator: Intl.Collator): number {
  if (typeof a === "number" && typeof b === "number") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return collator.compare(String(a), String(b));
}
