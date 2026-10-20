# Heading-aware chunker contract

Task: [#90](https://github.com/agthumoe/solid-lamp/issues/90). Parent plan: [brain](../../../specs/brain.md), task 4. Status: implementation contract for this isolated synthetic task; no real-vault or ADR 0006 work.

## Ownership

Codex owns `packages/brain/src/chunking/**` and this handoff directory. Claude owns #86/#87. Shared package bootstrap, root scripts, lockfile, canonical handoffs, parser/fixtures and host services are outside this issue's authored scope. The integrator adds exports/root test wiring once the brain package and #86 land.

## Inputs and outputs

`chunkMarkdown({ body, bodyStartLine? }, options?)` consumes the parser's Markdown body, with frontmatter already removed and a 1-based source offset. It performs no I/O, model invocation, tool dispatch or metadata interpretation. Output chunks have deterministic ordinals, exact contiguous content slices, UTF-16 start/end offsets into that body, inclusive source line ranges, heading path plus heading source line (duplicate-heading identity), estimated token count and `chunkerVersion`.

ATX headings (levels 1–6) and single-line setext headings define sections. Headings inside fenced or four-space-indented code are data. Fence lengths and closing markers must match. Heading text remains in the first chunk of its section. Each section is packed by paragraphs, then by lines, with Unicode-code-point splitting as the last fallback. Overlap never crosses a section, is capped at half the preceding chunk in UTF-16 units as well as its token budget, and never prevents forward progress (including with an optimistic estimator). Blank-only input yields no chunks; nonblank text is never discarded. Source LF/CRLF/CR line endings are preserved.

Defaults: target 650 estimated tokens, overlap at most 80, embed context 8192, context reserve 256 tokens. These are chunking knobs, not model bindings. The context/reserve must be supplied from the pinned embedding profile by integration. Every chunk satisfies both its estimated target and a conservative UTF-8-byte bound within the available context; this can make multilingual/code chunks shorter than the target. An indivisible Unicode scalar that cannot fit is an explicit programmer/configuration error, not truncation. There are no hardcoded model tags.

## Token calibration

The default is an estimate (UTF-8 bytes / 3), never claimed to be a tokenizer. `calibrateTokenEstimator(samples)` consumes caller-provided text plus measured token counts, fits the maximum observed tokens/byte with a safety multiplier, and reports count/ratio for diagnostics. Calibration performs no GPU calls. Measurements must come from the same pinned profile and include its prefixes/special-token accounting; callers reserve prefix/context overhead separately. Empty, invalid or inconsistent samples fail rather than producing an optimistic estimator. Live model calibration remains an integration/acceptance step under exclusive GPU coordination, not something synthetic tests prove. The byte bound and adapter `truncate: false` remain independent protection.

## Tests and integration

Test exact source slices/line locators, duplicate and skipped heading levels, fences/setext/code, paragraph packing, long single paragraphs/lines, CRLF/CR, emoji/combining text, deterministic overlap with full coverage, context bounds and calibration drift. Treat malicious instruction text exactly like other content. Run the suite directly with `node --test 'packages/brain/src/chunking/*.test.ts'`; root typecheck/lint cover the files automatically. No parser or filesystem behavior is duplicated here.
