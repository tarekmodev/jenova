/**
 * Incremental SSE frame parser for fetch-streamed responses (the search
 * console posts a JSON body, so native EventSource cannot be used; frames
 * arrive through a ReadableStream instead). Pure — unit-tested.
 *
 * Handles the api's frame shape (`event: <name>\ndata: <one-line JSON>`),
 * ignores comment heartbeats (`: keep-alive`), and carries partial frames
 * across chunk boundaries.
 */

export interface SseFrame {
  readonly event: string;
  readonly data: unknown;
}

export interface SseParserState {
  readonly buffer: string;
}

export const INITIAL_SSE_STATE: SseParserState = { buffer: "" };

export function feedSseChunk(
  state: SseParserState,
  chunk: string,
): { readonly state: SseParserState; readonly frames: readonly SseFrame[] } {
  const combined = state.buffer + chunk;
  const blocks = combined.split("\n\n");
  // The final piece may be an incomplete frame — keep it buffered.
  const rest = blocks.pop() ?? "";
  const frames: SseFrame[] = [];
  for (const block of blocks) {
    const frame = parseBlock(block);
    if (frame !== null) frames.push(frame);
  }
  return { state: { buffer: rest }, frames };
}

function parseBlock(block: string): SseFrame | null {
  let event: string | null = null;
  let data: string | null = null;
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice("event: ".length).trim();
    else if (line.startsWith("data: ")) data = line.slice("data: ".length);
    // Comment lines (": keep-alive", ": connected") are heartbeats — ignored.
  }
  if (event === null || data === null) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return null;
  }
}
