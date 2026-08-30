import { describe, expect, it } from "vitest";
import {
  isSupplierError,
  isSupplierErrorKind,
  SUPPLIER_ERROR_KINDS,
  SupplierError,
  type SupplierErrorKind,
} from "./errors";

describe("supplier error taxonomy", () => {
  it("covers exactly the seven kinds from docs/03-domain-model.md", () => {
    expect(SUPPLIER_ERROR_KINDS).toEqual([
      "sold_out",
      "price_changed",
      "invalid_request",
      "supplier_timeout",
      "supplier_rejected",
      "auth_failed",
      "rate_limited",
    ]);
  });

  it("guards kinds at runtime and narrows the type", () => {
    for (const kind of SUPPLIER_ERROR_KINDS) {
      expect(isSupplierErrorKind(kind)).toBe(true);
    }
    expect(isSupplierErrorKind("SOLD_OUT")).toBe(false);
    expect(isSupplierErrorKind("timeout")).toBe(false);
    const value = "sold_out" as string;
    if (isSupplierErrorKind(value)) {
      const k: SupplierErrorKind = value;
      expect(k).toBe("sold_out");
    }
  });
});

describe("SupplierError", () => {
  it("carries kind, supplierCode, message and raw payload", () => {
    const raw = { code: 4102 };
    const err = new SupplierError("sold_out", "no availability for the requested dates", {
      supplierCode: "4102",
      raw,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SupplierError");
    expect(err.kind).toBe("sold_out");
    expect(err.supplierCode).toBe("4102");
    expect(err.message).toBe("no availability for the requested dates");
    expect(err.raw).toBe(raw);
    expect(isSupplierError(err)).toBe(true);
  });

  it("supplierCode and raw are optional; cause is preserved when given", () => {
    const bare = new SupplierError("supplier_timeout", "deadline budget exhausted");
    expect(bare.supplierCode).toBeUndefined();
    expect(bare.raw).toBeUndefined();
    expect(bare.cause).toBeUndefined();

    const cause = new Error("socket hang up");
    const wrapped = new SupplierError("supplier_timeout", "deadline budget exhausted", { cause });
    expect(wrapped.cause).toBe(cause);
  });

  it("is distinguishable from plain errors", () => {
    expect(isSupplierError(new Error("boom"))).toBe(false);
    expect(isSupplierError(undefined)).toBe(false);
    expect(isSupplierError("sold_out")).toBe(false);
  });
});
