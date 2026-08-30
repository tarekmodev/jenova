# M10–12 — Flights via consolidator (months 10–12)

**Goal:** ticketed air travel through a consolidator API (Mystifly or TBO Air — per the
agreement signed by M7). No raw GDS, no IATA/BSP, **no exchanges at launch** (void/refund
only). The platform is already earning on hotels — flights extend, they don't gate.

## Deliverables
- [ ] **FlightSupplierAdapter contract** finalized: search (one-way/round/multi-city,
      cabin, pax types), fareRules, book (PNR), ticket, retrieve, void, refund; SOAP/XML
      codec exercised if Mystifly (JSON if TBO Air).
- [ ] **Consolidator adapter** with full normalization: itineraries/segments, fare
      breakdown (base/tax/fees as Money), baggage allowances, fare rules text (ar/en
      handling), ticketing time limits, unified error taxonomy; recordings for every
      flow including void windows and refund quotes.
- [ ] **Air services** (`api/air-search`, `api/air-booking`): air-specific state
      machine extension (PNR created → ticketed → voided/refund_pending/refunded);
      ticketing-time-limit tracking with auto-void protection in worker (never hold an
      unticketed PNR past its limit unnoticed).
- [ ] **Air UX** in every surface: search matrix (airlines × price), itinerary detail
      with fare rules, traveler details with passport/document capture, seat/baggage
      basics where the consolidator supports; corporate policy (cabin caps) applied at
      the gate; Partner API air endpoints.
- [ ] **Air money flows**: ticket → payable to consolidator; void → same-day reversal;
      refund → refund_pending with airline-refund tracking (weeks-late is normal) in the
      Finance app; ADM-style discrepancy queue.
- [ ] **E-ticket documents**: bilingual itinerary/receipt; delivery via email/WhatsApp.
- [ ] Platform Admin: air health board (search latency, ticketing failures, time-limit
      near-misses).

## Agent workstreams
1. **adapter-air** (longest pole; SOAP codec hardening).
2. **air services + time-limit worker** (❗human review — ticketing money paths).
3. **air UX across surfaces**.
4. **air finance flows** (❗human review).

## Tarek
- Consolidator production onboarding + certification; decide seat/baggage scope with
  their account manager. Review ticketing/refund PRs. Pilot with one agency that sells
  air today.

## Acceptance gate
In production: a real ticketed booking (consolidator live environment) books, voids
(within window) and — on a separate booking — completes a refund cycle end-to-end with
correct postings; zero unticketed PNRs pass their time limit during the pilot month.
