/**
 * Incremental text/event-stream parser for POST-initiated SSE (the search
 * endpoint streams over a fetch body — EventSource cannot POST). Pure and
 * unit-tested; the transport wiring lives in the search page.
 */

export interface SseEvent {
  readonly event: string;
  readonly data: string;
}

/** Feed chunks in, get complete events out; partial frames buffer across pushes. */
export class SseParser {
  #buffer = "";

  push(chunk: string): SseEvent[] {
    this.#buffer += chunk.replace(/\r\n/g, "\n");
    const events: SseEvent[] = [];
    let separator = this.#buffer.indexOf("\n\n");
    while (separator !== -1) {
      const frame = this.#buffer.slice(0, separator);
      this.#buffer = this.#buffer.slice(separator + 2);
      const parsed = parseFrame(frame);
      if (parsed !== null) {
        events.push(parsed);
      }
      separator = this.#buffer.indexOf("\n\n");
    }
    return events;
  }
}

function parseFrame(frame: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) {
      continue; // comment / heartbeat
    }
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  return { event, data: dataLines.join("\n") };
}

/**
 * Reads a streaming fetch Response as SSE, invoking `onEvent` per complete
 * frame. Resolves when the stream ends; rejects on transport failure.
 */
export async function consumeSseResponse(
  response: Response,
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (response.body === null) {
    throw new Error("SSE response has no body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      if (signal?.aborted === true) {
        await reader.cancel();
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        onEvent(event);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
