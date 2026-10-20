# Books and dated official sources

Issue: [#114](https://github.com/agthumoe/solid-lamp/issues/114). Status: **spec and synthetic parser fixtures; no parser or ingestion yet.** Parent: [#4](https://github.com/agthumoe/solid-lamp/issues/4). Requirements: [domain-agent plan](domain-agent-plan.md) (grounded book knowledge, source metadata), [domain source requirements](../workstreams/claude/domain-sources.md) (citation fields), [brain](brain.md) (scope: books and official sources are spec + fixtures in Phase 2). Fixtures: [`evals/brain/sources`](../../evals/brain/sources/README.md).

## Goal

Agents can cite a book by edition and page (or a stable EPUB location), and a law or rule by jurisdiction, section and effective period. Before that is trusted, a parser must reproduce the synthetic fixtures' expected output exactly. Models never claim to have "read" a book; they quote retrieved passages within excerpt limits.

## Non-goals

The EPUB/PDF parser and official-source adapters (follow-up issues once this spec is accepted); OCR; downloading anything; real books or real statutes in the repository.

## Acquisition

Books and official snapshots enter only as **files the owner supplies**: legally obtained EPUB/PDF and saved official pages, in a configured drop folder read through the verified reader (#88). The runtime fetches nothing. Automated official-source fetching is a separate future decision (network egress, terms of use, rate limits) and needs its own issue and approval.

## Source kinds and metadata

| Kind                | Required metadata                                                                                                                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `book_epub`         | title, creators, publisher, edition, publication year, language, identifier (ISBN or `null`), content hash of the file; per chunk: spine item, chapter heading path, EPUB location (spine index + element id), and the print page from page-list markers when present                                                                         |
| `book_pdf`          | the same book fields; per chunk: physical page index (0-based), **printed page label** (from `/PageLabels`; roman front matter differs from body numbering) and text-layer status                                                                                                                                                             |
| `official_snapshot` | `authority`, `jurisdiction` (`US-TX`, `US-federal`), citation (code + section), `document_date`, `effective_from` / `effective_to` (`null` = unknown, shown as unknown), `retrieved_at`, `status_flags` (`current`, `superseded`, `not_yet_effective`, `proposed`, `stale`, `synthetic`), source URL (recorded, not fetched) and content hash |

Every chunk also keeps the shared fields from [domain-sources](../workstreams/claude/domain-sources.md): `source_id`, `version`/`content_hash`, `locator`.

## Extraction rules (what the parser must do)

1. **Structure first.**
   - EPUB: follow the package's spine order from `content.opf`; titles come from the navigation document. Footnotes stay attached to their reference (`noteref` → `footnote`) and are not merged into body text. Figure captions are kept as captions.
   - PDF: extract per page; the citation page is the printed label, not the physical index.
2. **Quality gate.** A PDF page without a text layer is **quarantined** (`extraction: none`), never indexed as empty text and never OCR'd silently. A book whose quarantined pages exceed 2% is held for owner review. Extraction quality (`text_layer`, `quarantined_pages`) is stored with the source.
3. **Untrusted content.** Book and official text is data. Instruction-like text inside a source ("ignore previous instructions…") is extracted verbatim as content and can never select tools or change behaviour (AGENTS hard constraint 5).
4. **Determinism.** The same file gives the same chunks, locators and hashes.

## Citation formats

- **EPUB:** `book:<source_id> — <title>, <edition> (<year>), ch. "<chapter>", loc <spine>/<element id>[, p. <print page>]`
- **PDF:** `book:<source_id> — <title>, <edition> (<year>), p. <printed label>`
- **Official:** `<jurisdiction> <citation> (effective <from>–<to or "present">; retrieved <date>) [status]`

## Freshness and supersession (official sources)

- Each answer is evaluated at a date (normally "today"). A snapshot is `current` when `effective_from ≤ date < effective_to` (an open end counts as present). It is `superseded` when `effective_to ≤ date`, and `not_yet_effective` when `effective_from > date`, which is shown as an enacted future change, never as current law.
- A `proposed` rule is never law.
- A snapshot whose `retrieved_at` is older than the **staleness window (default 180 days)** is flagged `stale`, and the answer must say the source may be out of date.
- Several snapshots for one citation must not overlap in effective period; an overlap is a data error and fails ingestion.

## Excerpt limits

A retrieved book excerpt in an answer is at most **1,200 characters per source per answer**, with the citation. Whole chapters are never reproduced. Official texts are public-domain or government works in most cases, but each snapshot records its source terms; the limit applies unless the terms say otherwise.

## Acceptance tests for the future parser (fixtures in `evals/brain/sources`)

- **EPUB:**
  - spine order and chapter titles exactly as the manifest says;
  - each chapter's expected snippets present;
  - the footnote attached to its reference, not inline;
  - the figure caption kept;
  - the injection text extracted as plain content;
  - locators stable across two runs.
- **PDF:**
  - per-page text and **printed labels** (`i`, `ii`, `1`, `2`);
  - the text-less page quarantined with `extraction: none`;
  - the quarantine ratio computed;
  - byte-identical regeneration of the fixtures (determinism).
- **Official:**
  - metadata parsed;
  - status at the evaluation dates in the manifest (current, superseded, not yet effective, proposed, stale);
  - non-overlapping periods;
  - the `FICTIONAL — NOT LAW` marker preserved.

## Open questions

| Question                                         | Default until answered                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| EPUB/PDF libraries (zip/XML/PDF text extraction) | Choose in the parser issue with an ADR; pin exact versions, no native build scripts |
| Owner's book library and official-source scope   | Nothing ingested until the owner supplies files and approves                        |
| Automated official-source fetching               | Not built; owner-supplied snapshots only                                            |
