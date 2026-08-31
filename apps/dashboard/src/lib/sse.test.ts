import { describe, expect, it } from "vitest";
import { feedSseChunk, INITIAL_SSE_STATE } from "./sse";

describe("feedSseChunk", () => {
  it("parses complete frames and ignores heartbeat comments", () => {
    const { frames } = feedSseChunk(
      INITIAL_SSE_STATE,
      ': connected\n\nevent: search.started\ndata: {"searchId":"s1","supplierCodes":["tbo"]}\n\n: keep-alive\n\n',
    );
    expect(frames).toEqual([
      { event: "search.started", data: { searchId: "s1", supplierCodes: ["tbo"] } },
    ]);
  });

  it("carries a partial frame across chunk boundaries", () => {
    const first = feedSseChunk(INITIAL_SSE_STATE, 'event: supplier.results\ndata: {"supplierCo');
    expect(first.frames).toEqual([]);
    const second = feedSseChunk(first.state, 'de":"tbo","offers":[]}\n\n');
    expect(second.frames).toEqual([
      { event: "supplier.results", data: { supplierCode: "tbo", offers: [] } },
    ]);
    expect(second.state.buffer).toBe("");
  });

  it("drops malformed JSON without breaking the stream", () => {
    const { frames } = feedSseChunk(
      INITIAL_SSE_STATE,
      "event: x\ndata: {broken\n\nevent: search.completed\ndata: {\"status\":\"complete\"}\n\n",
    );
    expect(frames).toEqual([{ event: "search.completed", data: { status: "complete" } }]);
  });
});
