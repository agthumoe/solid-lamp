# Synthetic book and official-source fixtures

Task [#114](https://github.com/agthumoe/solid-lamp/issues/114); spec: [books and dated official sources](../../../docs/specs/book-official-sources.md). Everything here is **invented**: the book, its publisher, the statutes, the agency and the act are fictional, and every official snapshot carries a `FICTIONAL — NOT LAW` banner. Nothing here is evidence of retrieval quality; it is the target a future EPUB/PDF/official-source parser must reproduce.

| Path | What it exercises |
| --- | --- |
| `epub/imaginary-orchards/` | An unpacked EPUB 3 (container, package, nav with page list, two chapters): spine order, chapter titles, print pages, a footnote attached to its reference, a figure caption, and an injection attempt that must stay plain content |
| `pdf/orchard-handbook.pdf` | A text-layer PDF whose printed labels (`i`, `ii`, `1`, `2`) differ from physical page indexes |
| `pdf/scanned-notice.pdf` | Page 2 has no text layer and must be quarantined, so the book is held for review |
| `official/*.html` | One fictional section with superseded, current and not-yet-effective versions; a proposed rule; and a federal act retrieved long enough ago to be stale |

`manifest.json` holds the expected extraction and the expected status of each official snapshot at the evaluation dates. The PDFs are generated deterministically by `pnpm run brain:pdf-fixtures`. `scripts/brain/source-fixtures.test.ts` checks that the committed bytes match a fresh build, and it checks the fixtures' internal consistency. Formatters are told to ignore this directory so the bytes stay exact.
