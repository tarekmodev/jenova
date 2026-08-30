# B2C Storefront app

The tenant's own consumer website. Gate: **online payment capture** (mada, Apple Pay,
cards via the tenant's own gateway account). Deliberately NOT Modernize — custom,
lightweight, tenant-themeable Tailwind design with SSR for SEO. Future mobile apps are
also outside the Modernize rule.

## Dashboard section (storefront-admin)
- Theming: logo, colors, fonts within a safe palette system; preview before publish.
- Custom domain connection (DNS instructions + automated TLS).
- Content: destination pages, banners, promotions with date ranges; bilingual content
  editing (Arabic/English).
- Storefront settings: which verticals are sellable B2C, markup profile for the B2C
  channel, payment methods enabled, terms/privacy pages.

## Consumer website (external)
- SSR pages: home, destination content (SEO), search results, property detail.
- Search → offer → check → payment → confirmation, guest checkout first-class; account
  area for bookings/vouchers; Arabic-first with English mirror.
- Payment: hosted fields / redirect only — card data never touches Jenova (PCI SAQ-A).
  3-D Secure flow; on capture-success-but-book-fail, automatic void/refund path with a
  manual-intervention fallback.
- Booking documents delivered by email/WhatsApp; cancellation per policy with online
  refund where the gateway supports it.

## Invariants
- Same engine services as every other surface; the B2C markup rule and the payment gate
  are the only differences.
- A price shown is a price honored: the offer token's signed price is what's captured, or
  the consumer is re-prompted on `price_changed` — never silently charged differently.

## Acceptance heuristics
- Lighthouse: LCP < 2.5s on 4G for search results; SEO pages indexed with correct hreflang
  (ar/en).
- A mada payment on a real sandbox booking completes end-to-end, including the refund path.
