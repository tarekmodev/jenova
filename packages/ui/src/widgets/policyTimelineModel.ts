/**
 * CancellationPolicy → display timeline (pure — unit-tested).
 *
 * The domain's normalized policy (rules ordered by fromUtc; each penalty
 * applies from its instant until the next takes over — docs/03) becomes
 * a list of contiguous display segments: a leading free window, then one
 * segment per rule. `activeSegmentIndex` marks the segment in force at
 * `now` so the UI can highlight what cancelling TODAY costs.
 */

import {
  assertValidCancellationPolicy,
  type CancellationPolicy,
  type Money,
} from "@jenova/domain";

export interface PolicyTimelineSegment {
  /** null = from booking time (leading free window). */
  readonly fromUtc: string | null;
  /** null = until service/check-in (final segment). */
  readonly untilUtc: string | null;
  /** null = free cancellation. */
  readonly penalty: Money | null;
}

export interface PolicyTimeline {
  readonly refundable: boolean;
  readonly segments: readonly PolicyTimelineSegment[];
  /** Index into `segments` in force at `now`; -1 without a `now`. */
  readonly activeSegmentIndex: number;
}

export function computePolicyTimeline(policy: CancellationPolicy, now?: Date): PolicyTimeline {
  assertValidCancellationPolicy(policy);

  const segments: PolicyTimelineSegment[] = [];
  const firstRule = policy.rules[0];
  if (firstRule === undefined) {
    // No rules at all: free the whole way (domain resolvePenaltyAt
    // returns undefined for every instant).
    segments.push({ fromUtc: null, untilUtc: null, penalty: null });
  } else {
    // A non-refundable item is penalized from the booking moment
    // (docs/03) — no free window to advertise. Refundable policies get
    // the leading free segment up to the first deadline.
    if (policy.refundable) {
      segments.push({ fromUtc: null, untilUtc: firstRule.fromUtc, penalty: null });
    }
    for (const [index, rule] of policy.rules.entries()) {
      segments.push({
        fromUtc: rule.fromUtc,
        untilUtc: policy.rules[index + 1]?.fromUtc ?? null,
        penalty: rule.penalty,
      });
    }
  }

  let activeSegmentIndex = -1;
  if (now !== undefined) {
    const at = now.getTime();
    activeSegmentIndex = segments.findIndex((segment) => {
      const from = segment.fromUtc === null ? -Infinity : Date.parse(segment.fromUtc);
      const until = segment.untilUtc === null ? Infinity : Date.parse(segment.untilUtc);
      return at >= from && at < until;
    });
  }

  return { refundable: policy.refundable, segments, activeSegmentIndex };
}
