/**
 * On-disk recording format. Bump RECORDING_SCHEMA_VERSION on any breaking change
 * — including a fingerprint-algorithm change that would re-key existing
 * recordings — and keep the reader able to reject (loudly) versions it does
 * not understand.
 *
 * v2: XML volatile normalization added to the fingerprint (review M2) — XML
 * bodies with volatile-named attributes/elements fingerprint differently than
 * under v1. No recordings were ever committed under v1, so no migration.
 */
export const RECORDING_SCHEMA_VERSION = 2;

export interface RecordedRequest {
  method: string;
  /** Full URL as sent (sanitized before persisting to recordings/). */
  url: string;
  /** Lowercased header names, sorted alphabetically at serialization time. */
  headers: Record<string, string>;
  /** Text body (JSON or XML) or null. Binary bodies are not supported. */
  body: string | null;
}

export interface RecordedResponse {
  status: number;
  headers: Record<string, string>;
  body: string | null;
}

export interface Recording {
  schemaVersion: number;
  supplier: string;
  fingerprint: string;
  request: RecordedRequest;
  response: RecordedResponse;
  /**
   * durationMs only: wall-clock timestamps live in the raw capture, not here,
   * so re-recording the same scenario produces a quiet diff.
   */
  timings: { durationMs: number };
}

/** Unsanitized capture — persisted ONLY under raw-captures/ (gitignored). */
export interface RawCapture extends Recording {
  recordedAt: string;
}
