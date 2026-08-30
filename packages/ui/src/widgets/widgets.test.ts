import { BOOKING_ITEM_STATES, money, type CancellationPolicy } from "@jenova/domain";
import { describe, expect, it } from "vitest";
import { bookingStateAppearance, ESCALATED_APPEARANCE } from "./bookingStateAppearance";
import { computePolicyTimeline } from "./policyTimelineModel";
import {
  initialStreamingListState,
  streamingListReducer,
  type StreamingListState,
} from "./streaming";

// Structural synthetic values only (CLAUDE.md rule 5).

describe("bookingStateAppearance", () => {
  it("maps every canonical state", () => {
    for (const state of BOOKING_ITEM_STATES) {
      const appearance = bookingStateAppearance(state);
      expect(appearance.tone).toBeDefined();
      expect(appearance.variant).toBeDefined();
    }
  });

  it("distinguishes settled from active states and flags failures", () => {
    expect(bookingStateAppearance("confirmed").tone).toBe("success");
    expect(bookingStateAppearance("failed").tone).toBe("error");
    expect(bookingStateAppearance("completed").variant).toBe("outlined");
    expect(bookingStateAppearance("pending_confirmation").tone).toBe("warning");
  });

  it("escalated overrides any state with the alarm look", () => {
    for (const state of BOOKING_ITEM_STATES) {
      expect(bookingStateAppearance(state, true)).toEqual(ESCALATED_APPEARANCE);
    }
    expect(bookingStateAppearance("confirmed", false).tone).toBe("success");
  });
});

describe("streamingListReducer", () => {
  const run = (events: Parameters<typeof streamingListReducer<string>>[1][]) =>
    events.reduce<StreamingListState<string>>(
      (state, event) => streamingListReducer(state, event),
      initialStreamingListState<string>(),
    );

  it("started announces all lanes pending", () => {
    const state = run([{ type: "started", laneIds: ["lane-a", "lane-b"] }]);
    expect(state.lanes).toHaveLength(2);
    expect(state.lanes.every((lane) => lane.status === "pending")).toBe(true);
    expect(state.completion).toBe("streaming");
  });

  it("lane results append items and mark the lane", () => {
    const state = run([
      { type: "started", laneIds: ["lane-a", "lane-b"] },
      { type: "lane_results", laneId: "lane-a", items: ["item-1", "item-2"] },
      { type: "lane_failed", laneId: "lane-b", kind: "supplier_timeout" },
    ]);
    expect(state.items).toEqual(["item-1", "item-2"]);
    expect(state.lanes[0]).toMatchObject({ id: "lane-a", status: "results", itemCount: 2 });
    expect(state.lanes[1]).toMatchObject({
      id: "lane-b",
      status: "failed",
      failureKind: "supplier_timeout",
    });
  });

  it("budget_exhausted completion leaves unanswered lanes pending (partial set)", () => {
    const state = run([
      { type: "started", laneIds: ["lane-a", "lane-b"] },
      { type: "lane_results", laneId: "lane-a", items: ["item-1"] },
      { type: "completed", status: "budget_exhausted" },
    ]);
    expect(state.completion).toBe("budget_exhausted");
    expect(state.lanes[1]?.status).toBe("pending");
  });

  it("stream failure is terminal and distinct from lane failure", () => {
    const state = run([{ type: "started", laneIds: ["lane-a"] }, { type: "stream_failed" }]);
    expect(state.completion).toBe("failed");
  });

  it("an unannounced lane still surfaces (defensive)", () => {
    const state = run([{ type: "lane_results", laneId: "lane-x", items: [] }]);
    expect(state.lanes[0]?.id).toBe("lane-x");
  });
});

describe("computePolicyTimeline", () => {
  const penalty1 = money(10000, "SAR");
  const penalty2 = money(50000, "SAR");
  const policy: CancellationPolicy = {
    refundable: true,
    rules: [
      { fromUtc: "2026-03-10T00:00:00Z", penalty: penalty1 },
      { fromUtc: "2026-03-15T00:00:00Z", penalty: penalty2 },
    ],
  };

  it("builds free head + one segment per rule, contiguously", () => {
    const timeline = computePolicyTimeline(policy);
    expect(timeline.segments).toEqual([
      { fromUtc: null, untilUtc: "2026-03-10T00:00:00Z", penalty: null },
      { fromUtc: "2026-03-10T00:00:00Z", untilUtc: "2026-03-15T00:00:00Z", penalty: penalty1 },
      { fromUtc: "2026-03-15T00:00:00Z", untilUtc: null, penalty: penalty2 },
    ]);
    expect(timeline.activeSegmentIndex).toBe(-1);
  });

  it("marks the segment in force at now (matches domain resolvePenaltyAt)", () => {
    expect(computePolicyTimeline(policy, new Date("2026-03-01T00:00:00Z")).activeSegmentIndex).toBe(0);
    expect(computePolicyTimeline(policy, new Date("2026-03-12T00:00:00Z")).activeSegmentIndex).toBe(1);
    expect(computePolicyTimeline(policy, new Date("2026-03-20T00:00:00Z")).activeSegmentIndex).toBe(2);
    // Boundary instant: the new rule takes over exactly at fromUtc.
    expect(computePolicyTimeline(policy, new Date("2026-03-10T00:00:00Z")).activeSegmentIndex).toBe(1);
  });

  it("non-refundable: no free head — penalized from booking (docs/03)", () => {
    const nonRefundable: CancellationPolicy = {
      refundable: false,
      rules: [{ fromUtc: "2026-01-01T00:00:00Z", penalty: penalty2 }],
    };
    const timeline = computePolicyTimeline(nonRefundable, new Date("2026-02-01T00:00:00Z"));
    expect(timeline.refundable).toBe(false);
    expect(timeline.segments).toHaveLength(1);
    expect(timeline.segments[0]?.penalty).toEqual(penalty2);
    expect(timeline.activeSegmentIndex).toBe(0);
  });

  it("empty rules = free the whole way", () => {
    const timeline = computePolicyTimeline({ refundable: true, rules: [] }, new Date());
    expect(timeline.segments).toEqual([{ fromUtc: null, untilUtc: null, penalty: null }]);
    expect(timeline.activeSegmentIndex).toBe(0);
  });

  it("rejects out-of-order rules via the domain validator", () => {
    expect(() =>
      computePolicyTimeline({
        refundable: true,
        rules: [
          { fromUtc: "2026-03-15T00:00:00Z", penalty: penalty1 },
          { fromUtc: "2026-03-10T00:00:00Z", penalty: penalty2 },
        ],
      }),
    ).toThrowError();
  });
});
