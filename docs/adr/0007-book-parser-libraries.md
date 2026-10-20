# ADR 0007: EPUB and PDF parser libraries for book sources

Date: 2026-10-20. Status: **proposed**, not accepted. Tracking: [#129](https://github.com/agthumoe/solid-lamp/issues/129). Related: book and official-source spec and fixtures ([#114](https://github.com/agthumoe/solid-lamp/issues/114), PR #115), [ADR 0005](0005-phase1-stack-and-topology.md) (pinning and release-age policy).

## Context

The book-source spec (#114) needs owner-supplied EPUB and PDF files turned into structured text with citation locators. Its open question says to choose libraries in an ADR, pin exact versions, and allow no native build scripts. What the parser must do:

- **EPUB:**
  - read the zip container safely (no zip bombs, bounded entries);
  - parse `container.xml`, the OPF package (spine order, Dublin Core metadata) and the navigation document;
  - walk XHTML chapters for headings, `epub:type="pagebreak"` print-page markers, `noteref` → `footnote` pairs and `figcaption`s.
- **PDF:**
  - per-page text;
  - the printed page label from `/PageLabels` (roman front matter differs from body numbering);
  - detection of pages without a text layer, which are quarantined and never OCR'd.
- **Security:** files are untrusted input (AGENTS hard constraint 5). There must be no external entity resolution, no script evaluation, no network or font fetching, and bounded memory and time.
- **Constraints:** local-only, TypeScript on Node 24, exact pins, the pnpm supply-chain policy (release age), and no native code.

## Decision (proposed)

| Need                     | Library                     | Pin     | License    | Runtime deps                            | Published  |
| ------------------------ | --------------------------- | ------- | ---------- | --------------------------------------- | ---------- |
| EPUB container (zip)     | `fflate`                    | 0.8.3   | MIT        | 0                                       | 2026-05-16 |
| OPF / nav / XHTML (XML)  | `@xmldom/xmldom`            | 0.9.12  | MIT        | 0                                       | 2026-08-21 |
| PDF text and page labels | `pdfjs-dist` (legacy build) | 6.4.299 | Apache-2.0 | 0 (optional `@napi-rs/canvas` excluded) | 2026-10-03 |

None has install scripts. Usage rules that review can check:

1. **Zip:**
   - Read the central directory first through `unzipSync`'s `filter`.
   - Refuse archives over the configured entry count or total declared size, or any entry over the per-entry limit, before inflating.
   - Refuse entries whose path is absolute, contains `..` or a backslash, or is not referenced by the OPF.
   - The first entry must be an uncompressed `mimetype` of `application/epub+zip`.
2. **XML:**
   - Parse with `DOMParser` and an `onError` handler; any error or fatal error quarantines that document.
   - `DOCTYPE` declarations are refused outright. xmldom does not resolve external entities: the spike shows `&e;` for a `SYSTEM "file:///etc/passwd"` entity, plus a reported error.
   - Use namespace-aware lookups (`getAttributeNS` for `epub:type`).
3. **PDF:**
   - Load from bytes with `isEvalSupported: false`, `disableFontFace: true`, `useSystemFonts: false` and no `url`, so there is no network access, no font loading and no `eval`.
   - Read `getPageLabels()` and per-page `getTextContent()`. A page with no extracted text is `extraction: none`.
   - Run each document in a `worker_threads` worker with `resourceLimits` and a wall-clock deadline, and terminate it on breach.
   - `@napi-rs/canvas` is excluded with pnpm `ignoredOptionalDependencies`. Text extraction does not need it; pdf.js logs a warning, which the parser silences with `verbosity: 0` plus a filtered `console.warn`.
4. Pin all three exactly. Add them only to the package that hosts the parser (expected: `packages/brain`) when the parser issue starts, not before. The lockfile must pass `pnpm audit --audit-level high` (#116).

## Evidence (spike against the #114 synthetic fixtures)

The spike ran on 2026-10-20 in a scratch directory outside the repository with `npm install --ignore-scripts --omit=optional`. Three packages were added, with no transitive dependencies.

- **EPUB.**
  - The unpacked fixture was zipped with `fflate` (stored `mimetype` first) and read back: 7 entries, 3,958 declared bytes.
  - Spine: `ch01, ch02`. Title: "A Field Guide to Imaginary Orchards".
  - `ch01`: heading "Planting Moonlight Apples", page breaks `1, 2`, footnote `fn1`, and the figure caption.
  - `ch02`: heading "Pruning Under Two Suns", page break `3`.
  - Zero XML errors. All of it matches `manifest.json`.
- **PDF.**
  - `orchard-handbook.pdf`: labels `i, ii, 1, 2`, each page with text.
  - `scanned-notice.pdf`: labels `1, 2`; page index 1 has 0 extracted characters, so it is quarantined.
  - All of it matches `manifest.json`.
- **XXE.** The external-entity probe returned the literal `&e;` and one parser error. The file was not read.

## Alternatives considered

- **`yauzl` 3.4.0 (zip):** streaming and mature, but it adds a dependency (`pend`). Its async streaming API offers no advantage for EPUBs, which are bounded in size and read whole after the central-directory check.
- **`saxes` 6.0.0 (XML):** strict and small, but its last release was in 2021 and it brings a dependency (`xmlchars`). Unmaintained parsers of untrusted input are a liability.
- **`fast-xml-parser` 5.11.2:** six runtime dependencies, and its object model loses the mixed-content order needed for footnote references inside paragraphs.
- **`htmlparser2` 12.0.0:** tolerant HTML parsing, but four dependencies. Tolerance also hides malformed XHTML that the spec wants quarantined, not silently repaired.
- **`unpdf` 1.9.1:** a zero-dependency wrapper bundling a serverless pdf.js build. Version 1.9.1 was published one day ago (fails the release-age policy). It is also a second-hand bundle of the same engine, so `pdfjs-dist` gives clearer provenance and update control.
- **`pdf-parse` 2.4.5:** depends on `pdfjs-dist` _and_ requires `@napi-rs/canvas` (native).
- **Writing our own zip/XML/PDF readers:** more attack surface to own, and PDF in particular is not a reasonable in-house parser.

## Consequences

- **Good:** no native code, zero transitive dependencies for EPUB, mature engines, and checkable security rules. The spike already reproduces the fixture expectations, so the parser issue starts from known-good behaviour.
- **Bad:** `pdfjs-dist` is large (≈35 MB unpacked) and is primarily a browser library, so Node use needs the legacy build and warning suppression. xmldom's DOM keeps whole chapters in memory, which is acceptable under the per-entry limits.
- **Revisit if:**
  - a pinned version gets a high or critical advisory with no timely fix;
  - pdf.js drops Node support or makes canvas mandatory;
  - real owner EPUBs are commonly malformed enough that strict XML quarantines too many chapters (measure the quarantine rate first, then consider a tolerant XHTML path for body text only);
  - OCR is ever approved, which is a separate decision.
