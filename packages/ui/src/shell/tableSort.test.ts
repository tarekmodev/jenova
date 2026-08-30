import { describe, expect, it } from "vitest";
import { sortRows, toggleSort } from "./tableSort";

// Structural synthetic rows — sort mechanics only (CLAUDE.md rule 5).
interface Row {
  readonly id: string;
  readonly name: string | null;
  readonly total: number;
}

const rows: readonly Row[] = [
  { id: "r1", name: "beta", total: 300 },
  { id: "r2", name: "alpha", total: 100 },
  { id: "r3", name: null, total: 200 },
  { id: "r4", name: "alpha", total: 200 },
];

describe("toggleSort", () => {
  it("cycles unsorted → asc → desc → asc on one column", () => {
    const first = toggleSort(null, "name");
    expect(first).toEqual({ columnId: "name", direction: "asc" });
    const second = toggleSort(first, "name");
    expect(second.direction).toBe("desc");
    expect(toggleSort(second, "name").direction).toBe("asc");
  });

  it("switching column resets to asc", () => {
    expect(toggleSort({ columnId: "name", direction: "desc" }, "total")).toEqual({
      columnId: "total",
      direction: "asc",
    });
  });
});

describe("sortRows", () => {
  it("sorts numbers numerically both directions, stably", () => {
    expect(sortRows(rows, (row) => row.total, "asc").map((row) => row.id)).toEqual([
      "r2",
      "r3",
      "r4",
      "r1",
    ]);
    expect(sortRows(rows, (row) => row.total, "desc").map((row) => row.id)).toEqual([
      "r1",
      "r3",
      "r4",
      "r2",
    ]);
  });

  it("sorts strings with the locale collator; missing values always last", () => {
    expect(sortRows(rows, (row) => row.name, "asc", "en").map((row) => row.id)).toEqual([
      "r2",
      "r4",
      "r1",
      "r3",
    ]);
    expect(sortRows(rows, (row) => row.name, "desc", "en").map((row) => row.id)).toEqual([
      "r1",
      "r2",
      "r4",
      "r3",
    ]);
  });

  it("does not mutate the input", () => {
    const before = [...rows];
    sortRows(rows, (row) => row.total, "desc");
    expect(rows).toEqual(before);
  });
});
