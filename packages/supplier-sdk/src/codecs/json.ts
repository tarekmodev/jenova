/**
 * JSON codec (docs/05-suppliers.md): serialize + zod-validated parse shared
 * by every JSON adapter, so per-supplier code is mapping only. Malformed or
 * schema-violating payloads surface as SupplierError(invalid_request) with
 * a message that names every offending path.
 */

import { SupplierError } from "@jenova/domain";
import type { z } from "zod";

export interface JsonCodecOptions {
  /** Names the supplier in error messages; diagnostics only. */
  readonly supplierCode?: string;
}

export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

/** JSON.stringify with unserializable payloads mapped to invalid_request. */
export function serializeJson(value: unknown, options: JsonCodecOptions = {}): string {
  const who = options.supplierCode ?? "supplier";
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    throw new SupplierError(
      "invalid_request",
      `payload for ${who} is not JSON-serializable`,
      { cause: error },
    );
  }
  if (text === undefined) {
    throw new SupplierError(
      "invalid_request",
      `payload for ${who} serialized to nothing (undefined/function at the root)`,
    );
  }
  return text;
}

/**
 * Parse + validate in one step: the only way JSON enters an adapter.
 * Returns the schema's typed output; rejects with
 * SupplierError(invalid_request) naming each offending path.
 */
export function parseJsonWith<S extends z.ZodType>(
  schema: S,
  text: string,
  options: JsonCodecOptions = {},
): z.output<S> {
  const who = options.supplierCode ?? "supplier";
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new SupplierError("invalid_request", `${who} payload is not valid JSON`, {
      cause: error,
    });
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new SupplierError(
      "invalid_request",
      `${who} payload failed schema validation: ${formatZodIssues(result.error)}`,
      { raw },
    );
  }
  return result.data;
}
