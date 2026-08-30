/**
 * StreamingList: progressive fan-out rendering — lanes settle from
 * pending to results/failed, budget-exhausted banner for partial sets.
 * Lane ids and items are structural synthetic values; failure kinds are
 * the domain taxonomy (CLAUDE.md rule 5 — no supplier payloads).
 */

import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { money, type Money } from "@jenova/domain";
import { EmptyState } from "../shell/StatusStates";
import { MoneyText } from "../widgets/MoneyText";
import { StreamingList } from "../widgets/StreamingList";
import {
  initialStreamingListState,
  streamingListReducer,
  type StreamingListEvent,
  type StreamingListState,
} from "../widgets/streaming";
import { pickCopy } from "./support";

const meta: Meta = {
  title: "Widgets/StreamingList",
};
export default meta;

interface SyntheticOffer {
  readonly id: string;
  readonly title: string;
  readonly sell: Money;
}

function reduceAll(
  events: readonly StreamingListEvent<SyntheticOffer>[],
): StreamingListState<SyntheticOffer> {
  return events.reduce(
    (state, event) => streamingListReducer(state, event),
    initialStreamingListState<SyntheticOffer>(),
  );
}

function offers(globals: Record<string, unknown>): readonly SyntheticOffer[] {
  const copy = pickCopy(globals, {
    ar: { one: "عرض تجريبي أ", two: "عرض تجريبي ب", three: "عرض تجريبي ج" },
    en: { one: "Synthetic offer A", two: "Synthetic offer B", three: "Synthetic offer C" },
  });
  return [
    { id: "offer-1", title: copy.one, sell: money(125000, "SAR") },
    { id: "offer-2", title: copy.two, sell: money(98000, "SAR") },
    { id: "offer-3", title: copy.three, sell: money(150000, "SAR") },
  ];
}

function labels(globals: Record<string, unknown>) {
  const copy = pickCopy(globals, {
    ar: {
      lanes: { "lane-a": "مزوّد أ", "lane-b": "مزوّد ب", "lane-c": "مزوّد ج" } as Record<string, string>,
      timeout: "انتهت المهلة",
      budget: "انتهت مهلة البحث — النتائج المعروضة جزئية.",
      failed: "انقطع بث نتائج البحث. أعد المحاولة.",
      empty: { title: "لا نتائج من أي مزوّد", hint: "جرّب تواريخ أو وجهة أخرى" },
      streaming: "جارٍ البحث",
    },
    en: {
      lanes: { "lane-a": "Supplier A", "lane-b": "Supplier B", "lane-c": "Supplier C" } as Record<string, string>,
      timeout: "timed out",
      budget: "Search budget exhausted — showing partial results.",
      failed: "The result stream was interrupted. Try again.",
      empty: { title: "No results from any supplier", hint: "Try other dates or a different destination" },
      streaming: "Searching",
    },
  });
  return {
    laneLabel: (lane: { id: string }) => copy.lanes[lane.id] ?? lane.id,
    laneFailureLabel: () => copy.timeout,
    budgetExhausted: copy.budget,
    streamFailed: copy.failed,
    empty: <EmptyState title={copy.empty.title} description={copy.empty.hint} dense />,
    streamingLabel: copy.streaming,
  };
}

function OfferCard(props: { readonly offer: SyntheticOffer }) {
  return (
    <Card>
      <CardContent sx={{ paddingBlock: 1.5, "&:last-child": { paddingBlockEnd: 1.5 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography>{props.offer.title}</Typography>
          <MoneyText money={props.offer.sell} fontWeight={600} />
        </Stack>
      </CardContent>
    </Card>
  );
}

export const Streaming: StoryObj = {
  render: (_args, context) => {
    const items = offers(context.globals);
    const state = reduceAll([
      { type: "started", laneIds: ["lane-a", "lane-b", "lane-c"] },
      { type: "lane_results", laneId: "lane-a", items: [...items.slice(0, 2)] },
    ]);
    return (
      <StreamingList
        state={state}
        labels={labels(context.globals)}
        renderItem={(offer) => <OfferCard key={offer.id} offer={offer} />}
      />
    );
  },
};

export const BudgetExhausted: StoryObj = {
  render: (_args, context) => {
    const items = offers(context.globals);
    const state = reduceAll([
      { type: "started", laneIds: ["lane-a", "lane-b", "lane-c"] },
      { type: "lane_results", laneId: "lane-a", items: [...items.slice(0, 2)] },
      { type: "lane_failed", laneId: "lane-b", kind: "supplier_timeout" },
      { type: "completed", status: "budget_exhausted" },
    ]);
    return (
      <StreamingList
        state={state}
        labels={labels(context.globals)}
        renderItem={(offer) => <OfferCard key={offer.id} offer={offer} />}
      />
    );
  },
};

export const StreamFailed: StoryObj = {
  render: (_args, context) => {
    const state = reduceAll([
      { type: "started", laneIds: ["lane-a", "lane-b"] },
      { type: "stream_failed" },
    ]);
    return (
      <StreamingList
        state={state}
        labels={labels(context.globals)}
        renderItem={(offer) => <OfferCard key={offer.id} offer={offer} />}
      />
    );
  },
};

export const EmptyCompletion: StoryObj = {
  render: (_args, context) => {
    const state = reduceAll([
      { type: "started", laneIds: ["lane-a", "lane-b"] },
      { type: "lane_results", laneId: "lane-a", items: [] },
      { type: "lane_results", laneId: "lane-b", items: [] },
      { type: "completed", status: "complete" },
    ]);
    return (
      <StreamingList
        state={state}
        labels={labels(context.globals)}
        renderItem={(offer) => <OfferCard key={offer.id} offer={offer} />}
      />
    );
  },
};
