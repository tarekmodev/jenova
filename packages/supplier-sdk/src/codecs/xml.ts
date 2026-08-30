/**
 * XML/SOAP codec (docs/05-suppliers.md): envelope builder + parser shared by
 * every XML/SOAP adapter, so per-supplier code is mapping only.
 *
 * - Values are never auto-coerced to numbers (money must stay exact text
 *   until an adapter converts it to integer-minor-unit Money).
 * - SOAP faults are detected in both 1.1 and 1.2 shapes and mapped into the
 *   unified SupplierError taxonomy; adapters override classification per
 *   supplier via `classifyFault` when fault codes carry more meaning.
 * - Schema validation is zod on the parsed tree (the validation hook every
 *   parse goes through); XSD-level validation can slot in behind the same
 *   functions if a certification demands it.
 */

import { SupplierError, type SupplierErrorKind } from "@jenova/domain";
import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";
import type { z } from "zod";
import { formatZodIssues } from "./json";

const ATTR_PREFIX = "@_";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  format: false,
  suppressEmptyNode: true,
});

export interface XmlCodecOptions {
  /** Names the supplier in error messages; diagnostics only. */
  readonly supplierCode?: string;
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/** Build an XML document from a plain object tree (attributes via "@_" keys). */
export function buildXml(
  root: Readonly<Record<string, unknown>>,
  options: { readonly declaration?: boolean } = {},
): string {
  const xml = builder.build(root) as string;
  return options.declaration === false ? xml : `${XML_DECLARATION}${xml}`;
}

function parseTree(xml: string, who: string): Record<string, unknown> {
  const wellFormed = XMLValidator.validate(xml);
  if (wellFormed !== true) {
    throw new SupplierError(
      "invalid_request",
      `${who} payload is not well-formed XML: ${wellFormed.err.msg} (line ${wellFormed.err.line})`,
    );
  }
  return parser.parse(xml) as Record<string, unknown>;
}

/** Parse + zod-validate a plain (non-SOAP) XML document. */
export function parseXmlWith<S extends z.ZodType>(
  schema: S,
  xml: string,
  options: XmlCodecOptions = {},
): z.output<S> {
  const who = options.supplierCode ?? "supplier";
  const tree = parseTree(xml, who);
  const result = schema.safeParse(tree);
  if (!result.success) {
    throw new SupplierError(
      "invalid_request",
      `${who} payload failed schema validation: ${formatZodIssues(result.error)}`,
      { raw: tree },
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// SOAP envelope
// ---------------------------------------------------------------------------

export type SoapVersion = "1.1" | "1.2";

export const SOAP_ENVELOPE_NS: Readonly<Record<SoapVersion, string>> = {
  "1.1": "http://schemas.xmlsoap.org/soap/envelope/",
  "1.2": "http://www.w3.org/2003/05/soap-envelope",
};

export interface SoapEnvelopeInput {
  /** Body children as an object tree (attributes via "@_" keys). */
  readonly body: Readonly<Record<string, unknown>>;
  readonly header?: Readonly<Record<string, unknown>>;
  /** Defaults to SOAP 1.1 (the common travel-supplier vintage). */
  readonly version?: SoapVersion;
  /** Extra xmlns declarations on the Envelope: prefix → namespace URI. */
  readonly namespaces?: Readonly<Record<string, string>>;
}

export function buildSoapEnvelope(input: SoapEnvelopeInput): string {
  const version = input.version ?? "1.1";
  const envelope: Record<string, unknown> = {
    [`${ATTR_PREFIX}xmlns:soap`]: SOAP_ENVELOPE_NS[version],
  };
  for (const [prefix, uri] of Object.entries(input.namespaces ?? {})) {
    envelope[`${ATTR_PREFIX}xmlns:${prefix}`] = uri;
  }
  if (input.header !== undefined) {
    envelope["soap:Header"] = input.header;
  }
  envelope["soap:Body"] = input.body;
  return buildXml({ "soap:Envelope": envelope });
}

// ---------------------------------------------------------------------------
// SOAP fault detection → unified error taxonomy
// ---------------------------------------------------------------------------

export interface SoapFault {
  /** faultcode (1.1) or Code/Value (1.2), verbatim. */
  readonly code: string;
  /** faultstring (1.1) or Reason/Text (1.2), verbatim. */
  readonly reason: string;
  /** detail/Detail subtree when present, verbatim. */
  readonly detail: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textOf(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  const record = asRecord(value);
  if (record !== undefined) {
    const inner = record["#text"];
    if (typeof inner === "string") {
      return inner;
    }
  }
  return "";
}

/** Extract a SOAP 1.1 or 1.2 fault from a parsed (namespace-stripped) envelope. */
export function extractSoapFault(tree: Record<string, unknown>): SoapFault | undefined {
  const body = asRecord(asRecord(tree["Envelope"])?.["Body"]);
  const fault = asRecord(body?.["Fault"]);
  if (fault === undefined) {
    return undefined;
  }
  const code12 = asRecord(fault["Code"]);
  const reason12 = asRecord(fault["Reason"]);
  if (code12 !== undefined || reason12 !== undefined) {
    return {
      code: textOf(code12?.["Value"]),
      reason: textOf(reason12?.["Text"]),
      detail: fault["Detail"],
    };
  }
  return {
    code: textOf(fault["faultcode"]),
    reason: textOf(fault["faultstring"]),
    detail: fault["detail"],
  };
}

/**
 * Default fault classification by SOAP semantics: sender-side codes mean we
 * sent something the supplier refuses to understand; everything else is the
 * supplier rejecting the operation. Adapters refine per supplier.
 */
export function defaultSoapFaultKind(fault: SoapFault): SupplierErrorKind {
  const code = fault.code.toLowerCase();
  if (
    code.includes("client") ||
    code.includes("sender") ||
    code.includes("mustunderstand") ||
    code.includes("versionmismatch")
  ) {
    return "invalid_request";
  }
  return "supplier_rejected";
}

export interface ParseSoapOptions extends XmlCodecOptions {
  /** Per-supplier fault classification; defaults to defaultSoapFaultKind. */
  readonly classifyFault?: (fault: SoapFault) => SupplierErrorKind;
}

/**
 * Parse a SOAP response: well-formedness check, fault detection (throws the
 * classified SupplierError, fault code/subtree attached verbatim), then
 * zod validation of the Body against `schema`.
 */
export function parseSoapEnvelope<S extends z.ZodType>(
  schema: S,
  xml: string,
  options: ParseSoapOptions = {},
): z.output<S> {
  const who = options.supplierCode ?? "supplier";
  const tree = parseTree(xml, who);
  const fault = extractSoapFault(tree);
  if (fault !== undefined) {
    const classify = options.classifyFault ?? defaultSoapFaultKind;
    throw new SupplierError(
      classify(fault),
      `SOAP fault from ${who}: ${fault.reason || fault.code || "no reason given"}`,
      { supplierCode: fault.code, raw: fault },
    );
  }
  const body = asRecord(asRecord(tree["Envelope"])?.["Body"]);
  if (body === undefined) {
    throw new SupplierError(
      "invalid_request",
      `${who} payload is not a SOAP envelope (no Envelope/Body)`,
      { raw: tree },
    );
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new SupplierError(
      "invalid_request",
      `${who} SOAP body failed schema validation: ${formatZodIssues(result.error)}`,
      { raw: body },
    );
  }
  return result.data;
}
