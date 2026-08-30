/**
 * Unified supplier error taxonomy (docs/03-domain-model.md, CLAUDE.md rule 4).
 *
 * Adapters map every supplier error/fault — JSON, XML, or SOAP — into these
 * seven kinds at the boundary. Engine behavior (retry, surface, fail item)
 * keys off `kind`, never off supplier-specific codes; the original code and
 * payload ride along for diagnostics only.
 */

export const SUPPLIER_ERROR_KINDS = [
  "sold_out",
  "price_changed",
  "invalid_request",
  "supplier_timeout",
  "supplier_rejected",
  "auth_failed",
  "rate_limited",
] as const;
export type SupplierErrorKind = (typeof SUPPLIER_ERROR_KINDS)[number];

export function isSupplierErrorKind(value: string): value is SupplierErrorKind {
  return (SUPPLIER_ERROR_KINDS as readonly string[]).includes(value);
}

export interface SupplierErrorOptions {
  /** The supplier's own error/fault code, verbatim, for diagnostics. */
  readonly supplierCode?: string;
  /** The supplier's raw (sanitized) error payload, for diagnostics. */
  readonly raw?: unknown;
  readonly cause?: unknown;
}

export class SupplierError extends Error {
  readonly kind: SupplierErrorKind;
  readonly supplierCode: string | undefined;
  readonly raw: unknown;

  constructor(kind: SupplierErrorKind, message: string, options: SupplierErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SupplierError";
    this.kind = kind;
    this.supplierCode = options.supplierCode;
    this.raw = options.raw;
  }
}

export function isSupplierError(value: unknown): value is SupplierError {
  return value instanceof SupplierError;
}
