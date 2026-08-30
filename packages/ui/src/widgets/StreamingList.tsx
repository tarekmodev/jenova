"use client";

/**
 * <StreamingList/> — progressive fan-out results (SSE-driven).
 *
 * Renders a StreamingListState (see streaming.ts): a lane status strip
 * (per-supplier results/failed/pending), the items streamed so far, a
 * budget-exhausted banner for partial result sets, and the terminal
 * empty/failed states. All user-facing text arrives via props — lane
 * names and failure kinds are localized by the app.
 */

import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import type { ReactNode } from "react";
import type { StreamLane, StreamingListState } from "./streaming";

export interface StreamingListLabels {
  /** Localized display name per lane id (supplier names). */
  readonly laneLabel: (lane: StreamLane) => string;
  /** Localized tooltip-free failure suffix, e.g. from the error taxonomy. */
  readonly laneFailureLabel?: (lane: StreamLane) => string | undefined;
  /** Banner shown when completion is budget_exhausted (partial results). */
  readonly budgetExhausted: ReactNode;
  /** Shown when the stream itself failed. */
  readonly streamFailed: ReactNode;
  /** Shown when the search completed with zero items. */
  readonly empty: ReactNode;
  /** aria-label for the in-flight progress bar. */
  readonly streamingLabel?: string;
}

export interface StreamingListProps<Item> {
  readonly state: StreamingListState<Item>;
  readonly renderItem: (item: Item, index: number) => ReactNode;
  readonly labels: StreamingListLabels;
  /** Hide the lane strip (compact embeds). */
  readonly hideLanes?: boolean;
}

function laneChip(lane: StreamLane, labels: StreamingListLabels): ReactNode {
  const name = labels.laneLabel(lane);
  switch (lane.status) {
    case "pending":
      return (
        <Chip
          key={lane.id}
          size="small"
          variant="outlined"
          icon={<CircularProgress size={12} />}
          label={name}
          data-lane-status="pending"
        />
      );
    case "results":
      return (
        <Chip
          key={lane.id}
          size="small"
          color="success"
          variant="outlined"
          icon={<CheckCircleOutlineIcon />}
          label={`${name} · ${lane.itemCount}`}
          data-lane-status="results"
        />
      );
    case "failed": {
      const failure = labels.laneFailureLabel?.(lane);
      return (
        <Chip
          key={lane.id}
          size="small"
          color="error"
          variant="outlined"
          icon={<ErrorOutlineIcon />}
          label={failure !== undefined ? `${name} · ${failure}` : name}
          data-lane-status="failed"
        />
      );
    }
  }
}

export function StreamingList<Item>(props: StreamingListProps<Item>): ReactNode {
  const { state, labels } = props;
  const streaming = state.completion === "streaming";
  const done = !streaming;

  return (
    <Stack spacing={2}>
      {props.hideLanes !== true && state.lanes.length > 0 && (
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          {state.lanes.map((lane) => laneChip(lane, labels))}
        </Stack>
      )}

      {streaming && (
        <LinearProgress
          {...(labels.streamingLabel !== undefined
            ? { "aria-label": labels.streamingLabel }
            : {})}
        />
      )}

      {state.completion === "budget_exhausted" && (
        <Alert severity="warning">{labels.budgetExhausted}</Alert>
      )}
      {state.completion === "failed" && <Alert severity="error">{labels.streamFailed}</Alert>}

      <Stack spacing={1.5}>{state.items.map((item, index) => props.renderItem(item, index))}</Stack>

      {done && state.completion !== "failed" && state.items.length === 0 && labels.empty}
    </Stack>
  );
}
