/**
 * Vocabulary-drift diagnostics (review M1). Skipped-room events from the
 * mapper are counted per unrecognized value and surfaced as ONE structured
 * warn line per distinct value — supplier code + raw value only, never
 * payload dumps. The counter is the seam the Platform Admin supplier health
 * board reads (wired properly with the health board itself; the seam is the
 * M1 deliverable).
 */

import type { SkippedRoomRateEvent, SkippedRoomRateObserver } from "./mapping";

export interface SkippedRoomRateLog {
  readonly observer: SkippedRoomRateObserver;
  /** Occurrences per `<field>:<rawValue>` since this log was created. */
  counts(): ReadonlyMap<string, number>;
  total(): number;
}

// Structured stderr warn is the M1 logging surface for adapters; the api's
// logger seam replaces it when the engine wires observability.
const defaultWarn = (line: string): void => console.warn(line);

export function createSkippedRoomRateLog(
  warn: (line: string) => void = defaultWarn,
): SkippedRoomRateLog {
  const counts = new Map<string, number>();
  const observer = (event: SkippedRoomRateEvent): void => {
    const key = `${event.field}:${event.rawValue}`;
    const seen = counts.get(key) ?? 0;
    counts.set(key, seen + 1);
    if (seen === 0) {
      // First sighting of this value only — drift is a vocabulary-level
      // signal, and per-room repetition would just flood the log.
      warn(
        JSON.stringify({
          msg: "supplier_vocabulary_drift",
          supplier: event.supplierCode,
          hotelCode: event.hotelCode,
          field: event.field,
          rawValue: event.rawValue,
        }),
      );
    }
  };
  return {
    observer,
    counts: () => counts,
    total: () => [...counts.values()].reduce((sum, n) => sum + n, 0),
  };
}
