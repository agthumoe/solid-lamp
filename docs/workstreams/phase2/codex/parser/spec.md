# Note parsing contract

Task [#89](https://github.com/agthumoe/solid-lamp/issues/89); [brain plan](../../../../specs/brain.md), task 3. Synthetic-only implementation independent of source-reader, chunker, DB and worker tasks.

## Scope and inputs

`parseNote({ sourceId, path, text })` returns a discriminated parse result: a typed note or a generic error code. Paths are source-relative `.md` identifiers supplied by the verified reader; reject absolute paths, traversal, backslashes and URI schemes before constructing identities. This is lexical validation, not a filesystem/symlink security guarantee. Text is bounded to 2 MiB UTF-8. The parser never opens files, interprets instructions, chooses tools or resolves outside its supplied source index.

Frontmatter is recognized only at the beginning (optional BOM), with `---` delimiters. Limit YAML to 16 KiB, aliases to 20, object depth to 12, and traversal nodes to 4096; reject dangerous object keys and non-JSON values. Reuse pinned `yaml@2.8.4` and `zod@4.6.7` with duplicate-key checking. Invalid/missing-close/oversized frontmatter is reported by generic warning codes without echoing YAML or note text; body source offsets remain deterministic. Unterminated frontmatter is retained as body data. Closed invalid frontmatter is removed but metadata is empty. Invalid aliases/tags/title field types are ignored with a warning. Body line endings are preserved exactly. `bodyStartLine` is 1-based and compatible with chunker #90. No normalization hides byte/revision changes. Extraction is bounded to 2048 links and 2048 inline tags, with `MARKDOWN_LIMIT_EXCEEDED` identifying incomplete extraction.

## Markdown data

Extract Obsidian wikilinks, aliases, heading and block locators, and embeds with original offsets/line ranges. Keep raw target labels for `links.to_title`; display aliases do not change link targets. Heading-only links resolve to the current note. Ignore fenced/indented/inline code and escaped link/tag markers. Inline tags support letters/numbers/underscore/hyphen/nested slash, require a nonnumeric component, and do not treat heading markers or URL fragments as tags. Frontmatter aliases/tags are explicit metadata, never instructions. This is a documented Obsidian Markdown subset, not a full CommonMark AST.

`resolveNoteLinks(note, candidates)` searches only matching source IDs: relative/exact source path, unique filename, then unique frontmatter alias. Do not use a wikilink's display alias as a destination alias. Duplicate matches are explicit ambiguous results; missing, unsupported/external and escaping targets stay unresolved. Attachments may resolve as source-local candidates supplied by ingestion but are never opened. Path casing and Unicode spelling are preserved. Link extraction is independent of later DB IDs/revisions.

## Ownership and integration

Exclusive paths: `packages/brain/src/parsing/**`, `evals/brain/parser/**`, `docs/workstreams/phase2/codex/parser/**`. No root manifest/lockfile/scripts/CI, canonical STATUS/PLAN, Claude worktrees or #90 files. The package integrator declares `yaml@2.8.4` and `zod@4.6.7` in the brain manifest, exports this module at the package root and wires root brain tests/Makefile after #86; the existing root dependency is sufficient to execute this module's direct tests in this worktree.

Tests cover valid/invalid/bounded YAML, unsafe keys and aliases, CRLF/CR/BOM offsets, wikilink forms and code exclusion, tags, conservative scoped/ambiguous resolution and malicious text preserved as data. Synthetic fixture files live in `evals/brain/parser/`; no owner's content is used.
