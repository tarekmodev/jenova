/**
 * SSE parser unit tests — frames are the api's OWN wire format
 * (search.controller.ts `frame()`: named event + single-line JSON data,
 * comment heartbeats), exercised structurally. No supplier payloads here.
 */

import { describe, expect, it } from "vitest";
import { SseParser } from "./sse";

describe("SseParser", () => {
  it("parses a complete named-event frame", () => {
    const parser = new SseParser();
    const events = parser.push('event: search.started\ndata: {"searchId":"s1"}\n\n');
    expect(events).toEqual([{ event: "search.started", data: '{"searchId":"s1"}' }]);
  });

  it("buffers partial frames across pushes", () => {
    const parser = new SseParser();
    expect(parser.push("event: supplier.results\nda")).toEqual([]);
    expect(parser.push('ta: {"offers":[]}\n\n')).toEqual([
      { event: "supplier.results", data: '{"offers":[]}' },
    ]);
  });

  it("ignores comment heartbeats (': keep-alive')", () => {
    const parser = new SseParser();
    expect(parser.push(": connected\n\n: keep-alive\n\n")).toEqual([]);
  });

  it("handles several frames in one chunk, in order", () => {
    const parser = new SseParser();
    const events = parser.push(
      'event: search.started\ndata: {"a":1}\n\nevent: search.completed\ndata: {"b":2}\n\n',
    );
    expect(events.map((e) => e.event)).toEqual(["search.started", "search.completed"]);
  });

  it("normalizes CRLF line endings", () => {
    const parser = new SseParser();
    const events = parser.push('event: x\r\ndata: {"y":3}\r\n\r\n');
    expect(events).toEqual([{ event: "x", data: '{"y":3}' }]);
  });
});
