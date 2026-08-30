/**
 * Static proofs over the posting-template table (issue #69): every M1 edge
 * is declared, and every template balances by construction — the DB trigger
 * is the runtime enforcement, this is the merge-time one.
 */

import { describe, expect, it } from "vitest";
import { BOOKING_ITEM_TRANSITIONS, type BookingItemState } from "@jenova/domain";
import {
  assertTemplatesBalanced,
  POSTING_TEMPLATES,
  templateUsesPenalty,
  transitionEdge,
} from "./templates";

/** The edges M1 flows can produce (issued/amendment/completed land later). */
const M1_STATES: readonly BookingItemState[] = [
  "quoted",
  "reserved",
  "pending_confirmation",
  "confirmed",
  "cancelled",
  "failed",
];

describe("posting templates as data", () => {
  it("declares a template for every legal edge between M1 states", () => {
    for (const from of M1_STATES) {
      for (const to of BOOKING_ITEM_TRANSITIONS[from]) {
        if (!M1_STATES.includes(to)) continue;
        expect(
          POSTING_TEMPLATES[transitionEdge(from, to)],
          `edge ${from}->${to} must declare its financial meaning`,
        ).toBeDefined();
      }
    }
  });

  it("every template balances per amount source (debits === credits)", () => {
    expect(() => assertTemplatesBalanced()).not.toThrow();
  });

  it("catches an unbalanced template", () => {
    expect(() =>
      assertTemplatesBalanced({
        "reserved->confirmed": {
          description: "broken",
          lines: [
            { account: "sales", source: "sell", direction: "debit", memo: "one-sided" },
          ],
        },
      }),
    ).toThrow(/does not balance/);
  });

  it("reserve is a hold memo — deliberately no financial posting until the M3 credit engine", () => {
    expect(POSTING_TEMPLATES["quoted->reserved"]?.lines).toHaveLength(0);
  });

  it("confirm recognizes revenue and supplier liability on both sides", () => {
    const lines = POSTING_TEMPLATES["reserved->confirmed"]?.lines ?? [];
    expect(lines.map((l) => `${l.direction}:${l.account}:${l.source}`)).toEqual([
      "debit:agency_receivable:sell",
      "credit:sales:sell",
      "debit:cost_of_sales:net",
      "credit:supplier_payable:net",
    ]);
  });

  it("cancel from confirmed reverses confirm and re-charges the penalty", () => {
    const template = POSTING_TEMPLATES["confirmed->cancelled"];
    expect(template).toBeDefined();
    expect(templateUsesPenalty(template ?? { description: "", lines: [] })).toBe(true);
    expect(template?.lines).toHaveLength(8);
  });

  it("cancel from pending posts penalty only — nothing was recognized", () => {
    const lines = POSTING_TEMPLATES["pending_confirmation->cancelled"]?.lines ?? [];
    expect(lines.every((line) => line.source === "penalty")).toBe(true);
  });
});
