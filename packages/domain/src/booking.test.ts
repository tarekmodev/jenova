import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  assertTransition,
  assertValidCancellationPolicy,
  BOOKING_ITEM_STATES,
  BOOKING_ITEM_TRANSITIONS,
  canTransition,
  IllegalTransitionError,
  InvalidCancellationPolicyError,
  isTerminalState,
  resolvePenaltyAt,
  type BookingItemState,
  type CancellationPolicy,
} from "./booking";
import { money } from "./money";

const TERMINAL_STATES: readonly BookingItemState[] = ["completed", "cancelled", "failed"];

const stateArb = fc.constantFrom(...BOOKING_ITEM_STATES);

describe("BOOKING_ITEM_TRANSITIONS", () => {
  it("encodes the docs/03 happy path", () => {
    const happyPath: BookingItemState[] = [
      "quoted",
      "reserved",
      "pending_confirmation",
      "confirmed",
      "issued",
      "completed",
    ];
    for (let i = 0; i < happyPath.length - 1; i++) {
      expect(canTransition(happyPath[i] as BookingItemState, happyPath[i + 1] as BookingItemState)).toBe(true);
    }
  });

  it("pending_confirmation is optional: reserved may confirm directly", () => {
    expect(canTransition("reserved", "confirmed")).toBe(true);
  });

  it("amendment_pending is bidirectional with confirmed and issued", () => {
    expect(canTransition("confirmed", "amendment_pending")).toBe(true);
    expect(canTransition("amendment_pending", "confirmed")).toBe(true);
    expect(canTransition("issued", "amendment_pending")).toBe(true);
    expect(canTransition("amendment_pending", "issued")).toBe(true);
  });

  it("property: terminal states (completed/cancelled/failed) have no outgoing transitions", () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        const terminal = TERMINAL_STATES.includes(state);
        expect(BOOKING_ITEM_TRANSITIONS[state].length === 0).toBe(terminal);
        expect(isTerminalState(state)).toBe(terminal);
      }),
    );
  });

  it("property: no transition ever targets quoted or leaves a terminal state", () => {
    fc.assert(
      fc.property(stateArb, stateArb, (from, to) => {
        if (canTransition(from, to)) {
          expect(TERMINAL_STATES).not.toContain(from);
          expect(to).not.toBe("quoted");
          expect(from).not.toBe(to);
        }
      }),
    );
  });

  it("every non-initial state is reachable from quoted", () => {
    const reached = new Set<BookingItemState>(["quoted"]);
    const queue: BookingItemState[] = ["quoted"];
    for (let state = queue.shift(); state !== undefined; state = queue.shift()) {
      for (const next of BOOKING_ITEM_TRANSITIONS[state]) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }
    expect([...reached].sort()).toEqual([...BOOKING_ITEM_STATES].sort());
  });

  it("property: assertTransition throws exactly when canTransition is false", () => {
    fc.assert(
      fc.property(stateArb, stateArb, (from, to) => {
        if (canTransition(from, to)) {
          expect(() => assertTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertTransition(from, to)).toThrow(IllegalTransitionError);
        }
      }),
    );
  });
});

describe("CancellationPolicy", () => {
  const policy: CancellationPolicy = {
    refundable: true,
    rules: [
      { fromUtc: "2026-09-01T00:00:00Z", penalty: money(5_000, "SAR") },
      { fromUtc: "2026-09-10T00:00:00Z", penalty: money(20_000, "SAR") },
    ],
  };

  it("resolves no penalty before the first deadline", () => {
    expect(resolvePenaltyAt(policy, new Date("2026-08-15T12:00:00Z"))).toBeUndefined();
  });

  it("resolves the rule in force at the instant, inclusive of its boundary", () => {
    expect(resolvePenaltyAt(policy, new Date("2026-09-01T00:00:00Z"))).toEqual(money(5_000, "SAR"));
    expect(resolvePenaltyAt(policy, new Date("2026-09-05T09:30:00Z"))).toEqual(money(5_000, "SAR"));
    expect(resolvePenaltyAt(policy, new Date("2026-09-10T00:00:00Z"))).toEqual(money(20_000, "SAR"));
    expect(resolvePenaltyAt(policy, new Date("2027-01-01T00:00:00Z"))).toEqual(money(20_000, "SAR"));
  });

  it("a policy with no rules is free to cancel at any instant", () => {
    const free: CancellationPolicy = { refundable: true, rules: [] };
    expect(resolvePenaltyAt(free, new Date("2026-09-05T00:00:00Z"))).toBeUndefined();
  });

  it("rejects out-of-order rules, unparseable instants, and invalid Dates", () => {
    const outOfOrder: CancellationPolicy = {
      refundable: true,
      rules: [
        { fromUtc: "2026-09-10T00:00:00Z", penalty: money(1, "SAR") },
        { fromUtc: "2026-09-01T00:00:00Z", penalty: money(2, "SAR") },
      ],
    };
    expect(() => assertValidCancellationPolicy(outOfOrder)).toThrow(InvalidCancellationPolicyError);
    const garbage: CancellationPolicy = {
      refundable: false,
      rules: [{ fromUtc: "not-a-date", penalty: money(1, "SAR") }],
    };
    expect(() => resolvePenaltyAt(garbage, new Date())).toThrow(InvalidCancellationPolicyError);
    expect(() => resolvePenaltyAt(policy, new Date(NaN))).toThrow(InvalidCancellationPolicyError);
  });

  it("property: the resolved penalty is the last rule at or before the instant", () => {
    const instantsArb = fc
      .array(fc.integer({ min: 0, max: 4_000_000_000_000 }), { minLength: 1, maxLength: 8 })
      .map((ms) => [...ms].sort((a, b) => a - b));
    fc.assert(
      fc.property(
        instantsArb,
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        (instants, at) => {
          const generated: CancellationPolicy = {
            refundable: true,
            rules: instants.map((ms, i) => ({
              fromUtc: new Date(ms).toISOString(),
              penalty: money((i + 1) * 100, "SAR"),
            })),
          };
          const resolved = resolvePenaltyAt(generated, new Date(at));
          const lastIndex = instants.filter((ms) => ms <= at).length - 1;
          if (lastIndex < 0) {
            expect(resolved).toBeUndefined();
          } else {
            expect(resolved).toEqual(money((lastIndex + 1) * 100, "SAR"));
          }
        },
      ),
    );
  });
});
