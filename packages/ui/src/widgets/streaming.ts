/**
 * Streaming search state (pure reducer — unit-tested).
 *
 * Mirrors the engine's SSE vocabulary for fan-out searches (apps/api
 * hotel-search: search.started / supplier.results / supplier.failed /
 * search.completed with status complete|budget_exhausted). A "lane" is
 * one supplier fan-out branch. The transport (EventSource wiring, auth,
 * URLs) belongs to the app; it maps its SSE frames onto these events and
 * feeds them to the reducer, then renders <StreamingList/> from the
 * state. Failure kinds pass through as opaque strings — the app maps
 * them to localized text via its catalogs.
 */

export type StreamLaneStatus = "pending" | "results" | "failed";

export interface StreamLane {
  readonly id: string;
  readonly status: StreamLaneStatus;
  /** Item count contributed by this lane (results lanes). */
  readonly itemCount: number;
  /** Taxonomy kind for failed lanes (domain SupplierErrorKind etc.). */
  readonly failureKind?: string;
}

export type StreamCompletion = "streaming" | "complete" | "budget_exhausted" | "failed";

export interface StreamingListState<Item> {
  readonly lanes: readonly StreamLane[];
  readonly items: readonly Item[];
  readonly completion: StreamCompletion;
}

export type StreamingListEvent<Item> =
  | { readonly type: "started"; readonly laneIds: readonly string[] }
  | { readonly type: "lane_results"; readonly laneId: string; readonly items: readonly Item[] }
  | { readonly type: "lane_failed"; readonly laneId: string; readonly kind?: string }
  | { readonly type: "completed"; readonly status: "complete" | "budget_exhausted" }
  | { readonly type: "stream_failed" };

export function initialStreamingListState<Item>(): StreamingListState<Item> {
  return { lanes: [], items: [], completion: "streaming" };
}

export function streamingListReducer<Item>(
  state: StreamingListState<Item>,
  event: StreamingListEvent<Item>,
): StreamingListState<Item> {
  switch (event.type) {
    case "started":
      return {
        lanes: event.laneIds.map((id) => ({ id, status: "pending", itemCount: 0 })),
        items: [],
        completion: "streaming",
      };
    case "lane_results":
      return {
        ...state,
        lanes: upsertLane(state.lanes, event.laneId, {
          status: "results",
          itemCount: event.items.length,
        }),
        items: [...state.items, ...event.items],
      };
    case "lane_failed":
      return {
        ...state,
        lanes: upsertLane(state.lanes, event.laneId, {
          status: "failed",
          ...(event.kind !== undefined ? { failureKind: event.kind } : {}),
        }),
      };
    case "completed":
      // Lanes still pending at completion stay pending — with
      // budget_exhausted that is exactly the "never answered" signal.
      return { ...state, completion: event.status };
    case "stream_failed":
      return { ...state, completion: "failed" };
  }
}

function upsertLane(
  lanes: readonly StreamLane[],
  laneId: string,
  patch: Partial<Omit<StreamLane, "id">>,
): readonly StreamLane[] {
  if (lanes.some((lane) => lane.id === laneId)) {
    return lanes.map((lane) => (lane.id === laneId ? { ...lane, ...patch } : lane));
  }
  // A lane the started frame never announced (defensive) still shows up.
  return [...lanes, { id: laneId, status: "pending", itemCount: 0, ...patch }];
}
