# Synthetic fixture vault and no-database pipeline test

Issue: [#112](https://github.com/agthumoe/solid-lamp/issues/112). Status: implemented. Parent: [#4](https://github.com/agthumoe/solid-lamp/issues/4). Builds on: [source boundary](source-boundary.md) (#88), the parser and chunker (#89, #90), and the [parser fixtures](../../evals/brain/parser/README.md).

## Goal

Give ingestion a real synthetic vault of `.md` files, so the reader, parser and chunker are tested together on the same bytes the parser fixtures describe, without a database and without the owner's vault.

## `pnpm run brain:fixture-vault [dir]`

- Copies every note listed in `evals/brain/parser/manifest.json` from its `.md.fixture` source **byte-for-byte** (CRLF, malformed YAML and Unicode names included) and verifies each file's SHA-256 after writing.
- The default target is `evals/brain/vault`, which is git- and Prettier-ignored, so the fixtures stay the single source of truth.
- It rebuilds from scratch. It clears a directory only when that directory carries the `.aetherion-fixture-vault` marker the script writes, refuses any other non-empty directory, and refuses to write inside `evals/brain/parser`. It never modifies the fixtures.

## Pipeline test (`packages/brain/src/sources/fixture-pipeline.test.ts`)

On a temporary materialized vault:

- the verified reader lists exactly the manifest's 40 paths and reads each one with no refusals, byte-identical to its fixture;
- `parseNote` matches the manifest's tags, aliases, link targets and warnings;
- every chunk from `chunkMarkdown` maps back to exactly its content through its offsets in the original bytes;
- adversarial instruction text comes through as data.

A second test covers the script's safety: a rebuild removes stray files, a foreign directory is refused and left intact, and a target inside the fixtures is refused.

## Not yet

A second scan after edits through the change planner needs #93 (PR #109). The `fixture-vault` source in `config/sources.yaml` is enabled or disabled with #110 (PR #111).
