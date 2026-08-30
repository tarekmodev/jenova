# 11 — Glossary

| Term | Meaning |
|------|---------|
| Aggregator / bedbank | Wholesale supplier API consolidating many hotels (TBO, RateHawk, Hotelbeds). |
| Allotment | Rooms a hotel commits to a contract per day; released back near arrival. |
| BSP / IATA | Airline settlement/accreditation — avoided entirely by using a consolidator. |
| Board basis | Meal plan: RO (room only), BB, HB, FB, AI. |
| CDC | Change data capture — powers the sub-tenant Data Vault sync. |
| Consolidator | Flight wholesaler with an API that handles ticketing (Mystifly, TBO Air). |
| CSID | ZATCA cryptographic device credential used to sign/clear invoices. |
| Data Vault | A sub-tenant's continuously synced copy of its own data in a DB it hosts. |
| DMC | Destination management company — ground-heavy tour operator. |
| Entitlement | The flag that says a tenant has an app installed. |
| Fan-out (migrations) | Running a migration across the control-plane DB and every tenant DB. |
| Fan-out (search) | Querying all enabled suppliers in parallel under a time budget. |
| Look-to-book | Searches per booking — suppliers cap it commercially. |
| mada | Saudi domestic card scheme; essential for B2C conversion. |
| Manual-intervention queue | Bookings in states automation can't safely resolve. |
| Markup rule | Ordered most-specific-wins pricing rule (net → sell). |
| NDC | Airline distribution standard (direct airline APIs) — a later air source. |
| Net / sell | Supplier price vs price after markup. |
| Offer token | Signed, short-lived reference to a server-priced result — the only bookable thing. |
| PDPL | Saudi Personal Data Protection Law. |
| PNR | Passenger name record — the airline booking reference. |
| Saga | Multi-item booking coordinator: confirm all or compensate. |
| Stop-sale | Instant halt of sales for a property/room/date range (Contracting app). |
| Sub-tenant | An agency (B2B) or corporate partner (Corporate) under a tenant. |
| Tenant | A travel company licensing Jenova. |
| TRAACS | Nucore's travel accounting system — the GCC agency back-office standard; first finance connector. |
| Void | Same-day ticket cancellation before airline settlement. |
| ZATCA / Fatoora | Saudi tax authority / its e-invoicing platform (Phase 2 clearance). |
