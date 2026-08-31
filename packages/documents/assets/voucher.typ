// Jenova hotel voucher — bilingual single document (Arabic primary RTL +
// English mirror), tenant-branded (issue #99; CLAUDE.md rule 9).
//
// Data arrives as JSON through `sys.inputs.data` (see voucher-content.ts for
// the shape) — values are never spliced into markup, so guest/hotel strings
// cannot be interpreted as Typst code. `date: none` pins deterministic
// output: same input JSON → byte-identical PDF.

#let d = json(bytes(sys.inputs.data))
#let brand = rgb(d.brand.color)

#set document(date: none, title: "Voucher " + d.confirmation)
#set page(paper: "a4", margin: (x: 16mm, y: 14mm))
#set text(font: ("Noto Naskh Arabic", "Noto Sans"), size: 10.5pt)

// --- Branded header: logo slot (tenant legal name when no logo) ------------
#block(fill: brand, inset: 12pt, radius: 4pt, width: 100%)[
  #grid(
    columns: (1fr, auto),
    align: (left + horizon, right + horizon),
    [
      #if d.brand.logo != none {
        image(d.brand.logo, height: 30pt)
      } else {
        text(fill: white, weight: "bold", size: 15pt, font: "Noto Sans")[#d.brand.name]
      }
    ],
    [
      #set text(fill: white)
      #text(size: 13pt, weight: "bold", lang: "ar", dir: rtl)[قسيمة إقامة فندقية] \
      #text(size: 10pt, font: "Noto Sans")[Hotel Accommodation Voucher]
    ],
  )
]

#v(6pt)
#align(center)[
  #text(size: 9pt, fill: luma(90))[#d.brand.name] \
  #text(size: 15pt, weight: "bold", fill: brand, font: "Noto Sans")[#d.confirmation]
]
#v(2pt)

// --- Language sections (primary first, mirror second) ----------------------
#for s in d.sections [
  #set text(
    lang: s.lang,
    dir: if s.dir == "rtl" { rtl } else { ltr },
    font: if s.lang == "ar" { ("Noto Naskh Arabic", "Noto Sans") } else { ("Noto Sans", "Noto Naskh Arabic") },
  )
  #v(8pt)
  #text(size: 12.5pt, weight: "bold", fill: brand)[#s.title]
  #v(2pt)
  #table(
    columns: (auto, 1fr),
    align: start,
    stroke: 0.5pt + luma(200),
    inset: 6pt,
    ..for row in s.rows {
      (
        table.cell(fill: luma(245))[#text(weight: "bold")[#row.label]],
        [#row.value],
      )
    },
  )
  #v(4pt)
  #text(weight: "bold")[#s.policyTitle]
  #list(..s.policyLines)
  #v(4pt)
  #line(length: 100%, stroke: 0.5pt + luma(210))
]

#v(6pt)
#align(center)[#text(size: 7.5pt, fill: luma(120), font: "Noto Sans")[#d.footer]]
