import { fingerprintRequest, type FingerprintOptions } from "./fingerprint.js";
import { DEFAULT_REDACTED_PARAMS, sanitizeRecording, type RedactionConfig } from "./sanitize.js";
import {
  DEFAULT_RAW_CAPTURES_DIR,
  DEFAULT_RECORDINGS_DIR,
  readRecordingFile,
  writeRecordingFile,
} from "./store.js";
import { RECORDING_SCHEMA_VERSION, type RawCapture, type Recording } from "./types.js";

/** Shape adapters program against — a (url, init) subset of fetch/undici. */
export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export type ReplayMode = "record" | "replay";

/**
 * A fingerprint with no recording. Always thrown, never recovered from — a
 * silent fallback or generated response would put fabricated supplier data
 * into the test suite (CLAUDE.md rule 5).
 */
export class ReplayMissError extends Error {
  readonly fingerprint: string;
  readonly supplier: string;

  constructor(fingerprint: string, supplier: string) {
    super(`record this scenario first: ${fingerprint} (supplier ${supplier})`);
    this.name = "ReplayMissError";
    this.fingerprint = fingerprint;
    this.supplier = supplier;
  }
}

export interface ReplayTransportConfig {
  mode: ReplayMode;
  /** Supplier slug — recordings live under recordings/<supplier>/. */
  supplier: string;
  recordingsDir?: string;
  rawCapturesDir?: string;
  /** Underlying transport for record mode; defaults to global fetch. */
  fetch?: FetchLike;
  fingerprint?: FingerprintOptions;
  /** Extra redactions on top of the safe defaults — never instead of them. */
  redact?: RedactionConfig;
}

/**
 * Credential params must be volatile for fingerprinting too: they never leak
 * into the hash input, and rotating sandbox credentials cannot orphan
 * recordings.
 */
function fingerprintOptions(config: ReplayTransportConfig): FingerprintOptions {
  const credentialParams = [...DEFAULT_REDACTED_PARAMS, ...(config.redact?.queryParams ?? [])];
  return {
    volatileParams: [...credentialParams, ...(config.fingerprint?.volatileParams ?? [])],
    volatileBodyKeys: [...credentialParams, ...(config.fingerprint?.volatileBodyKeys ?? [])],
  };
}

function requestBodyText(init: RequestInit | undefined): string | null {
  const body = init?.body;
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return body;
  throw new TypeError(
    "sandbox-replay only records text bodies (JSON or XML) — pass the body as a string",
  );
}

function headersToRecord(headers: RequestInit["headers"] | Headers): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [name, value] of new Headers(headers)) record[name.toLowerCase()] = value;
  return record;
}

/** Hop-by-hop/derived headers that would corrupt a reconstructed Response. */
const UNREPLAYABLE_RESPONSE_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding"]);

function reconstructResponse(recording: Recording): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(recording.response.headers)) {
    if (!UNREPLAYABLE_RESPONSE_HEADERS.has(name)) headers.set(name, value);
  }
  return new Response(recording.response.body, { status: recording.response.status, headers });
}

/**
 * Recording proxy (docs/09-testing.md): wraps the adapter transport in
 * development, captures each request/response pair and persists one recording
 * per interaction, keyed by the normalized request fingerprint.
 *
 * Record mode must never run in CI — look-to-book against live sandboxes is a
 * commercial obligation (CLAUDE.md rule 5).
 */
export function createReplayTransport(config: ReplayTransportConfig): FetchLike {
  const recordingsDir = config.recordingsDir ?? DEFAULT_RECORDINGS_DIR;
  const rawCapturesDir = config.rawCapturesDir ?? DEFAULT_RAW_CAPTURES_DIR;

  if (config.mode === "replay") {
    // Replay resolves from recordings ONLY. No network, no fallback, no
    // generated responses — a miss fails loudly with the fingerprint to
    // record (docs/09-testing.md).
    return async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const urlText = url instanceof URL ? url.toString() : url;
      const fingerprint = fingerprintRequest(
        method,
        urlText,
        requestBodyText(init),
        fingerprintOptions(config),
      );
      const recording = await readRecordingFile(recordingsDir, config.supplier, fingerprint);
      if (recording === undefined) throw new ReplayMissError(fingerprint, config.supplier);
      return reconstructResponse(recording);
    };
  }

  // Only an injected transport may record under CI — the network path would
  // hit live sandboxes, and look-to-book is a commercial obligation.
  if (process.env["CI"] && config.fetch === undefined) {
    throw new Error(
      "record mode is forbidden in CI: tests resolve from recordings only (CLAUDE.md rule 5)",
    );
  }
  const realFetch = config.fetch ?? globalThis.fetch;

  return async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const urlText = url instanceof URL ? url.toString() : url;
    const requestBody = requestBodyText(init);
    const fingerprint = fingerprintRequest(method, urlText, requestBody, fingerprintOptions(config));

    const startedAt = new Date();
    const started = performance.now();
    const response = await realFetch(url, init);
    const responseBody = await response.text();
    const durationMs = Math.round(performance.now() - started);

    const capture: RawCapture = {
      schemaVersion: RECORDING_SCHEMA_VERSION,
      supplier: config.supplier,
      fingerprint,
      recordedAt: startedAt.toISOString(),
      request: {
        method,
        url: urlText,
        headers: headersToRecord(init?.headers),
        body: requestBody,
      },
      response: {
        status: response.status,
        headers: headersToRecord(response.headers),
        body: responseBody === "" ? null : responseBody,
      },
      timings: { durationMs },
    };

    // Quarantine: the unsanitized capture only ever lands in raw-captures/
    // (gitignored); recordings/ receives the sanitized version exclusively.
    await writeRecordingFile(rawCapturesDir, capture);

    const recording: Recording = sanitizeRecording(
      {
        schemaVersion: capture.schemaVersion,
        supplier: capture.supplier,
        fingerprint: capture.fingerprint,
        request: capture.request,
        response: capture.response,
        timings: capture.timings,
      },
      config.redact,
    );
    await writeRecordingFile(recordingsDir, recording);

    // Hand the caller a reconstruction of what was recorded, so development
    // and replay observe byte-identical responses.
    return reconstructResponse(recording);
  };
}
