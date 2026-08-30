import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RECORDING_SCHEMA_VERSION, type RawCapture, type Recording } from "./types.js";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

export const DEFAULT_RECORDINGS_DIR = join(PACKAGE_ROOT, "recordings");
export const DEFAULT_RAW_CAPTURES_DIR = join(PACKAGE_ROOT, "raw-captures");

export function recordingPath(dir: string, supplier: string, fingerprint: string): string {
  return join(dir, supplier, `${fingerprint}.json`);
}

function sortedHeaders(headers: Record<string, string>): Record<string, string> {
  const sorted: Record<string, string> = {};
  for (const name of Object.keys(headers).sort()) {
    const value = headers[name];
    if (value !== undefined) sorted[name.toLowerCase()] = value;
  }
  return sorted;
}

/**
 * Deterministic, human-diffable serialization: fixed top-level key order,
 * alphabetized lowercase headers, 2-space indent, trailing newline.
 */
export function serializeRecording(recording: Recording | RawCapture): string {
  const canonical: Record<string, unknown> = {
    schemaVersion: recording.schemaVersion,
    supplier: recording.supplier,
    fingerprint: recording.fingerprint,
    ...("recordedAt" in recording ? { recordedAt: recording.recordedAt } : {}),
    request: {
      method: recording.request.method,
      url: recording.request.url,
      headers: sortedHeaders(recording.request.headers),
      body: recording.request.body,
    },
    response: {
      status: recording.response.status,
      headers: sortedHeaders(recording.response.headers),
      body: recording.response.body,
    },
    timings: { durationMs: recording.timings.durationMs },
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

export async function writeRecordingFile(
  dir: string,
  recording: Recording | RawCapture,
): Promise<string> {
  const path = recordingPath(dir, recording.supplier, recording.fingerprint);
  await mkdir(join(dir, recording.supplier), { recursive: true });
  await writeFile(path, serializeRecording(recording), "utf8");
  return path;
}

export async function readRecordingFile(
  dir: string,
  supplier: string,
  fingerprint: string,
): Promise<Recording | undefined> {
  const path = recordingPath(dir, supplier, fingerprint);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const recording = JSON.parse(raw) as Recording;
  if (recording.schemaVersion !== RECORDING_SCHEMA_VERSION) {
    throw new Error(
      `recording ${path} has schemaVersion ${String(recording.schemaVersion)}; ` +
        `this reader understands ${String(RECORDING_SCHEMA_VERSION)} — re-record it`,
    );
  }
  return recording;
}
