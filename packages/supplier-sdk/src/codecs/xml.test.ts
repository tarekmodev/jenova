// Codec mechanics proven on tiny generic envelopes only — the fault shapes
// are the SOAP specification's own, nothing imitates any supplier API
// (CLAUDE.md rule 5).
import { describe, expect, it } from "vitest";
import { isSupplierError } from "@jenova/domain";
import { z } from "zod";
import {
  buildSoapEnvelope,
  buildXml,
  defaultSoapFaultKind,
  extractSoapFault,
  parseSoapEnvelope,
  parseXmlWith,
  SOAP_ENVELOPE_NS,
} from "./xml";

function capture(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

describe("buildXml / parseXmlWith", () => {
  it("round-trips a trivial document without coercing values", () => {
    const xml = buildXml({ Ping: { value: "0100" } });
    expect(xml).toContain("<Ping><value>0100</value></Ping>");
    const schema = z.object({ Ping: z.object({ value: z.string() }) });
    const parsed = parseXmlWith(schema, xml);
    // "0100" must survive as text — never a coerced number (money safety).
    expect(parsed.Ping.value).toBe("0100");
  });

  it("maps non-well-formed XML to invalid_request", () => {
    const error = capture(() => parseXmlWith(z.object({}), "<Ping><value>"));
    expect(isSupplierError(error) && error.kind).toBe("invalid_request");
  });

  it("maps schema violations to invalid_request naming the path", () => {
    const schema = z.object({ Ping: z.object({ value: z.string() }) });
    const error = capture(() => parseXmlWith(schema, "<Pong>1</Pong>"));
    expect(isSupplierError(error) && error.kind).toBe("invalid_request");
    expect(isSupplierError(error) ? error.message : "").toContain("Ping");
  });
});

describe("buildSoapEnvelope", () => {
  it("wraps the body in a 1.1 envelope with extra namespaces", () => {
    const xml = buildSoapEnvelope({
      body: { Ping: { value: "1" } },
      namespaces: { t: "urn:test" },
    });
    expect(xml).toContain(`xmlns:soap="${SOAP_ENVELOPE_NS["1.1"]}"`);
    expect(xml).toContain('xmlns:t="urn:test"');
    expect(xml).toContain("<soap:Body><Ping><value>1</value></Ping></soap:Body>");
  });

  it("emits the 1.2 namespace and a header when asked", () => {
    const xml = buildSoapEnvelope({
      body: { Ping: "1" },
      header: { Trace: "x" },
      version: "1.2",
    });
    expect(xml).toContain(`xmlns:soap="${SOAP_ENVELOPE_NS["1.2"]}"`);
    expect(xml).toContain("<soap:Header><Trace>x</Trace></soap:Header>");
  });
});

describe("parseSoapEnvelope", () => {
  const schema = z.object({ Pong: z.object({ value: z.string() }) });
  const okEnvelope = buildSoapEnvelope({ body: { Pong: { value: "ok" } } });

  it("validates the Body and returns typed output", () => {
    const parsed = parseSoapEnvelope(schema, okEnvelope);
    expect(parsed.Pong.value).toBe("ok");
  });

  it("rejects a non-envelope document as invalid_request", () => {
    const error = capture(() => parseSoapEnvelope(schema, "<Pong>ok</Pong>"));
    expect(isSupplierError(error) && error.kind).toBe("invalid_request");
  });

  it("maps a 1.1 Client fault to invalid_request with the code attached", () => {
    const xml = buildSoapEnvelope({
      body: { "soap:Fault": { faultcode: "soap:Client", faultstring: "bad input" } },
    });
    const error = capture(() => parseSoapEnvelope(schema, xml));
    expect(isSupplierError(error) && error.kind).toBe("invalid_request");
    expect(isSupplierError(error) ? error.supplierCode : "").toContain("Client");
    expect(isSupplierError(error) ? error.message : "").toContain("bad input");
  });

  it("maps a 1.1 Server fault to supplier_rejected", () => {
    const xml = buildSoapEnvelope({
      body: { "soap:Fault": { faultcode: "soap:Server", faultstring: "backend down" } },
    });
    const error = capture(() => parseSoapEnvelope(schema, xml));
    expect(isSupplierError(error) && error.kind).toBe("supplier_rejected");
  });

  it("maps a 1.2 Sender fault to invalid_request", () => {
    const xml = buildSoapEnvelope({
      body: {
        "soap:Fault": {
          "soap:Code": { "soap:Value": "soap:Sender" },
          "soap:Reason": { "soap:Text": "cannot parse" },
        },
      },
      version: "1.2",
    });
    const error = capture(() => parseSoapEnvelope(schema, xml));
    expect(isSupplierError(error) && error.kind).toBe("invalid_request");
    expect(isSupplierError(error) ? error.message : "").toContain("cannot parse");
  });

  it("lets adapters override fault classification", () => {
    const xml = buildSoapEnvelope({
      body: { "soap:Fault": { faultcode: "soap:Server", faultstring: "token expired" } },
    });
    const error = capture(() =>
      parseSoapEnvelope(schema, xml, { classifyFault: () => "auth_failed" }),
    );
    expect(isSupplierError(error) && error.kind).toBe("auth_failed");
  });
});

describe("fault helpers", () => {
  it("extractSoapFault returns undefined for a fault-free envelope", () => {
    const xml = buildSoapEnvelope({ body: { Pong: "1" } });
    // Parse through the public API to get the namespace-stripped tree shape.
    const parsed = parseSoapEnvelope(z.looseObject({}), xml);
    expect(extractSoapFault({ Envelope: { Body: parsed } })).toBeUndefined();
  });

  it("defaultSoapFaultKind is sender→invalid_request, otherwise supplier_rejected", () => {
    expect(defaultSoapFaultKind({ code: "soap:Client", reason: "", detail: undefined })).toBe(
      "invalid_request",
    );
    expect(defaultSoapFaultKind({ code: "env:Sender", reason: "", detail: undefined })).toBe(
      "invalid_request",
    );
    expect(defaultSoapFaultKind({ code: "soap:Server", reason: "", detail: undefined })).toBe(
      "supplier_rejected",
    );
    expect(defaultSoapFaultKind({ code: "", reason: "", detail: undefined })).toBe(
      "supplier_rejected",
    );
  });
});
