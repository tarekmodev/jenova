"use client";

/**
 * <PolicyTimeline/> — a normalized CancellationPolicy as a deadline
 * timeline: free window, then each penalty step, with the segment in
 * force at `now` highlighted. Labels arrive via props (apps own the
 * catalogs); penalties render through MoneyText, deadlines through
 * DateText (Gregorian primary, optional Hijri secondary).
 */

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import type { CancellationPolicy } from "@jenova/domain";
import { DateText } from "./DateText";
import type { NumeralSystem } from "./formatMoney";
import { MoneyText } from "./MoneyText";
import { computePolicyTimeline, type PolicyTimelineSegment } from "./policyTimelineModel";

export interface PolicyTimelineLabels {
  /** "Free cancellation" segment label. */
  readonly free: string;
  /** Chip shown for a non-refundable policy. */
  readonly nonRefundable: string;
  /** Prefix for a deadline instant, e.g. "until". */
  readonly until: string;
  /** Prefix for the open-ended tail, e.g. "from". */
  readonly from: string;
  /** Marks the segment in force now, e.g. "current". */
  readonly now: string;
}

export interface PolicyTimelineProps {
  readonly policy: CancellationPolicy;
  readonly labels: PolicyTimelineLabels;
  /** Highlights the segment in force at this instant. */
  readonly now?: Date;
  readonly numerals?: NumeralSystem;
  /** Show Hijri secondary lines on deadlines (display only). */
  readonly hijri?: boolean;
}

function segmentWindow(
  segment: PolicyTimelineSegment,
  props: PolicyTimelineProps,
): ReactNode {
  const dateProps = {
    ...(props.numerals !== undefined ? { numerals: props.numerals } : {}),
    ...(props.hijri !== undefined ? { hijri: props.hijri } : {}),
    dateStyle: "medium" as const,
    timeStyle: "short" as const,
  };
  if (segment.untilUtc !== null) {
    return (
      <Typography variant="body2" color="text.secondary" component="span">
        {props.labels.until} <DateText utc={segment.untilUtc} {...dateProps} />
      </Typography>
    );
  }
  if (segment.fromUtc !== null) {
    return (
      <Typography variant="body2" color="text.secondary" component="span">
        {props.labels.from} <DateText utc={segment.fromUtc} {...dateProps} />
      </Typography>
    );
  }
  return null;
}

export function PolicyTimeline(props: PolicyTimelineProps): ReactNode {
  const timeline = computePolicyTimeline(props.policy, props.now);

  return (
    <Stack spacing={0}>
      {!timeline.refundable && (
        <Box sx={{ marginBlockEnd: 1.5 }}>
          <Chip label={props.labels.nonRefundable} color="error" size="small" />
        </Box>
      )}
      {timeline.segments.map((segment, index) => {
        const active = index === timeline.activeSegmentIndex;
        const last = index === timeline.segments.length - 1;
        const free = segment.penalty === null;
        return (
          <Stack key={index} direction="row" spacing={1.5} data-active={active ? "true" : undefined}>
            {/* Marker column: dot + connector (logical flow, flips with direction). */}
            <Stack alignItems="center" sx={{ width: 16, flexShrink: 0 }}>
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  marginBlockStart: "5px",
                  backgroundColor: free ? "success.main" : "warning.main",
                  ...(active
                    ? { outline: "3px solid", outlineColor: free ? "success.light" : "warning.light" }
                    : {}),
                }}
              />
              {!last && (
                <Box sx={{ width: "2px", flexGrow: 1, backgroundColor: "divider", minHeight: 14 }} />
              )}
            </Stack>
            <Stack sx={{ paddingBlockEnd: last ? 0 : 2 }} spacing={0.25}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                {free ? (
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }} color="success.main">
                    {props.labels.free}
                  </Typography>
                ) : (
                  <MoneyText
                    money={segment.penalty}
                    variant="subtitle1"
                    fontWeight={600}
                    {...(props.numerals !== undefined ? { numerals: props.numerals } : {})}
                  />
                )}
                {active && <Chip label={props.labels.now} size="small" color="primary" />}
              </Stack>
              {segmentWindow(segment, props)}
            </Stack>
          </Stack>
        );
      })}
    </Stack>
  );
}
