# 05 — Supplier integrations

## Position: technology partner, never a buyer

Jenova certifies integrations with aggregators as a **technology partner** — free sandbox
credentials, no deposits, no credit, no bookings on Jenova's account. Each tenant plugs
its **own** production credentials into `SupplierAccount` and trades on its own
commercial relationship. Certified platforms get listed by suppliers → an acquisition
channel. The only Jenova-side supplier work is: build, certify, monitor.

## Adapter contracts

One interface per vertical, one lifecycle for all suppliers:

```
search → check (revalidate price/availability) → book → retrieve → cancel
(air adds: fareRules, ticket, void, refund)
```

- Each adapter is an isolated package under `packages/adapters/<vertical>/<supplier>/`.
- **Normalization is the adapter's whole job.** No supplier shape crosses the boundary.
  Canonical targets: Money (currency, minor units, tax inclusion), UTC instants from
  supplier-local deadlines, occupancy/pax encodings, room & board-basis codes,
  normalized CancellationPolicy, amendment rules, and the unified error taxonomy
  (`sold_out · price_changed · invalid_request · supplier_timeout · supplier_rejected ·
  auth_failed · rate_limited`).
- **Wire-format agnostic**: JSON REST, XML, and SOAP all satisfy the same contract. The
  supplier-sdk ships shared transport codecs (retrying HTTP client with budgets and
  circuit breakers, JSON serializer, XML/SOAP builder-parser with schema validation) so
  mapping code is the only per-supplier difference.
- Idempotency: booking calls carry a client reference the adapter must pass through, so
  retries never double-book.
- Every adapter ships: contract-test suite passing against recorded sandbox traffic
  (see 09-testing), a certification checklist + automated run report, and a health
  probe used by Platform Admin supplier boards.
- **Certification honesty rule:** a contract scenario the live run cannot drive
  deterministically (a nondeterministic sandbox failure mode) or must not drive
  deliberately (e.g. forcing 429s against a look-to-book obligation) is DECLARED by the
  adapter as evidence-backed — citing committed real recordings or a transport-layer
  mechanism test — and the run report renders it as EVIDENCE with the basis, never as a
  pass. A live run is CERTIFIABLE only when every check passed or carries declared
  evidence; capability differences (e.g. whether retrieve echoes the client reference)
  are likewise declared by the adapter, never inferred from response values.

## Hotel content mapping

Different suppliers name the same hotel differently. Jenova licenses a mapping service
(Vervotech or GIATA — budget item) rather than building dedup; canonical property IDs
anchor search dedup and the Contracting app. A back-office mapping-override queue
handles the tail. Room-type mapping is best-effort with visible supplier room names.

## Integration roadmap

Order finalized against Tarek's supplier test-credentials list (in hand — development is
sandbox-first from M1). Certification paperwork starts month 1, parallel to code.

| # | Supplier | Vertical | Wire | Why | Milestone |
|---|----------|----------|------|-----|-----------|
| 1 | TBO Holidays | Hotels | JSON | GCC/India strength, friendly certification | M1–M2 |
| 2 | RateHawk (ETG) | Hotels | JSON | Coverage + nets, modern API, generous sandbox | M3 |
| 3 | Hotelbeds | Hotels | JSON (signed) | Volume benchmark; heavier certification | M4–M5 |
| 4 | Hotelbeds Transfers + Activities | Ground | JSON | Two verticals from one relationship | M8–9 |
| 5 | Viator or GRNconnect | Activities | JSON | Depth beyond Hotelbeds | M8–9 |
| 6 | Mystifly or TBO Air | Flights | SOAP/XML or JSON | Consolidator = ticketing without GDS/IATA/BSP | M10–12 |
| 7 | Internal Contracting store | Hotels (own) | in-proc | Tenant contracts as an internal adapter | M17–20 |
| 8 | Duffel / NDC direct | Flights | JSON | Optional second air source | later |

## Rules of thumb

- Two hotel suppliers before any second vertical — two force the contract, mapping, and
  cheapest-rate logic to be real; one lets its quirks leak into the core.
- Flights via consolidator only (no raw GDS, no exchanges at launch — void/refund only).
- Nationality is a first-class search parameter everywhere (GCC rates vary by it).
- Look-to-book ratios are commercial obligations: cache aggressively, and never let CI
  or load tests hit live sandboxes (recorded replay only).
