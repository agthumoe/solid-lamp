# Phase 2 plan review — PR #85

Date: 2026-10-18. Reviewer: Codex. Task: [#84](https://github.com/agthumoe/solid-lamp/issues/84), under [#4](https://github.com/agthumoe/solid-lamp/issues/4). Reviewed proposal: [PR #85](https://github.com/agthumoe/solid-lamp/pull/85), head `0ed2f69bcf2256c57b6deadd6f84ea2c079efe79`.

**Recommendation: revise before approving implementation.** The vault-first scope, local inference, one GPU gate, stdio MCP, isolated restore and explicit real-data approval are appropriate. The original plan leaves important versioning, concurrency and acceptance contracts unspecified. The accompanying [revised brain spec](../specs/brain.md) addresses these at the design level; [ADR 0006](../adr/0006-brain-version-bound-retrieval.md) is proposed for architectural review. None of these changes proves the eventual implementation or authorizes real-vault access.

## Findings against the original draft

### F1 — P1: pinned search cannot use the current role-only embedding RPC

Original locations: brain spec, Embedding lifecycle and Search contract (lines 65–81 at the reviewed head).

The plan promises that a search started on version A keeps A's embedding space while B builds/promotes. However, [the RPC request](../../packages/llm/src/rpc/contract.ts) accepts only `texts`, `kind` and call fields, and [the inference service](../../apps/inference/src/gate/inference-service.ts) always resolves the current embed role. After switching that role, a query pinned to A can receive B's vector. Equal dimensions do not make the spaces compatible. The response also lacks digest/prefix identity needed to verify the space.

**Revision:** add prerequisite version-bound embedding RPC using an opaque trusted profile ID, server-side catalog/artifact validation and returned profile identity. Retain active/building/reader profiles and pin SQL's version explicitly. No caller-selected model tags or second GPU gate.

**Required tests:** A and B have equal dimensions but different model/prefix identities; pause an A search, promote B, and verify that query embedding and both retrieval branches still use A. Reject profile/digest mismatch before querying or storing a vector. Exercise the same case across an inference restart and with A unavailable.

### F2 — P1: versioning vectors alone does not isolate a chunker rebuild

Original locations: Embedding lifecycle (lines 65–67) and Schema additions (lines 89–95).

The [existing migration](../../supabase/migrations/20261018120000_brain_core.sql) makes `(document_id, ordinal)` unique, with embeddings referencing shared mutable chunk rows. A changed chunker cannot store a second layout under that key. Replacing active chunks would remove or invalidate A's vectors and citations before B is ready. Separately, the deferred active-version FK ensures pointer/status consistency, not complete coverage when an edit arrives between coverage check and promotion.

**Revision:** immutable revision/chunker chunk sets, per-version selection, an upgrade migration, expected-revision publication and a transactional ingestion watermark/lock at promotion. Both branches share eligibility rules. Retain reader state; revalidate rollback coverage. Promote only under approved ingestion/administrative policy.

**Required tests:** a failed rechunk keeps A searchable; edit/delete races cannot publish stale results; an edit arriving at the promotion boundary blocks incomplete promotion or is included atomically; an in-flight query retains its mapping; rollback of a stale prior version is rejected.

### F3 — P1: path validation must cover the file-open race

Original location: Ingestion rules, Source boundary (line 56).

`realpath` plus a containment check does not by itself stop a path or parent directory from being replaced with a symlink before an ordinary file open. This matters for the explicit promise that indexing cannot read outside the vault. Trusted local ownership of the process does not make every file path immutable.

**Revision:** require a root-relative verified open strategy with component checks and fail-closed behavior where containment cannot be guaranteed. Reject symlinks in every component; enforce exclusions before reads, regular-file checks and bounded file size/time. The implementation issue must select and test the actual mechanism on each supported filesystem; this review does not claim a portable Node helper already exists.

**Required tests:** traversal, sibling-prefix confusion, excluded folders, final/ancestor/root symlink replacement during open, device files, oversized notes, and `/mnt/c` behavior when that source type is enabled. An unsupported containment guarantee must block ingestion rather than downgrade the safety gate.

### F4 — P2: residency alone cannot establish the five-second target

Original locations: Embed residency (line 68), Risks and Evaluation.

Even warm embeddings can wait more than five seconds behind a non-preemptible generation. Polling/debounce can consume the budget before a job starts. Measuring only embedding time or warm/idle edits would overstate acceptance.

**Revision:** measure stable write to active hybrid-search visibility, including detection and all queue/load/publication time. Report cold, busy, burst and supported filesystem scenarios, with percentiles and maxima. Preserve the original target; a miss requires an explicit measured tradeoff and owner decision, not an implicit warm-only exemption.

**Required tests/evidence:** externally timed writes with idle and busy inference, cold load, queued background batches and `/mnt/c` polling if used. Latency acceptance remains open when a required scenario fails.

### F5 — P2: hashing/idempotency needs revision and durable-dispatch rules

Original locations: Change detection (line 57), Jobs and Schema additions.

Two different notes can have identical content; hash matching alone cannot prove a rename. Normalization may hide metadata/newline changes that affect filters and line citations. Delayed jobs can overwrite newer edits/deletes without a revision check. A path hash cannot reconstruct a pending job's source path after Redis loss.

**Revision:** exact source revision identity distinct from reusable embedding content, conservative rename matching, expected-revision publication, durable source-relative location references and transactional pending-event dispatch. A partial/offline scan must not tombstone the whole source.

**Required tests:** duplicate notes, ambiguous rename pairs, frontmatter-only and newline-only edits, older completion after a delete, crash between DB commit and queue insertion, Redis loss, and a failed/partial resync. Repeated recovery converges without stale resurrection or duplicate effects.

### F6 — P2: relevance and private API behavior need executable contracts

Original locations: Search contract (lines 72–81) and MCP/access (lines 85–87).

RRF ranks can give an unrelated nearest neighbor the same rank score as a relevant top result; the proposed threshold needs absolute relevance evidence. The draft names `brain_get_note` without an API excerpt route, puts service-key work in the last MCP task, and does not explicitly require authentication/origin checks on every earlier brain route. These gaps could produce misleading answers or expose private retrieval before MCP integration.

**Revision:** separate rank fusion from calibrated cosine/lexical evidence gates; distinguish `no_match` from unavailable/unindexed states; freeze gates before held-out evaluation. Add a bounded citation-based excerpt route. Put dedicated service-key and origin checks, loopback enforcement, no-store responses, safe logging and resource limits in the API task itself. Cite revision/source identity as well as display path/heading.

**Required tests:** unrelated nearest neighbors, answerable abstentions counted as misses, filters applied before branch limits, duplicate headings, stale/forged citations, missing/invalid keys and origins with zero downstream work, and CLI/MCP parity. Fake-embedding CI validates mechanics; a separate local real-model run must validate semantic retrieval.

### F7 — P2: recovery/task dependencies and real-data gate contradict the order

Original locations: Recovery gate (lines 101–107), Evaluation (lines 112–113) and tasks 12–13 (lines 148–151).

Task 1 cannot test the final hybrid-query contract before task 9 exists. Task 12 explicitly runs real-vault questions and real-note context experiments, while the final paragraph claims task 13 is the first real-vault access. A restored Phase 1 fixture alone also cannot prove that later schema additions restore correctly.

**Revision:** baseline synthetic restore in task 1, final-schema/hybrid-query restore before task 13; synthetic-only task 12; all real reading, question drafting and real-note experiments move behind D1/D2 into task 13. Protect dumps with private permissions/checksums, refuse existing/primary restore targets, and separate maintenance credentials. Clarify that plan approval does not imply D2.

**Required tests/evidence:** restore refusal before touching a primary/existing target, final-schema round-trip with stable cited IDs, reader/writer/maintenance privilege separation, and no real source enabled during tasks 1–12. No real-vault test was performed during this review.

## What the next reviewer should decide

- Review the revised profile registry and immutable chunk-set proposal in ADR 0006; implementation must update the RPC/schema contracts together.
- Check that the 13 ordered tasks include their prerequisite tests and the final recovery gate. The book/official-source docs/fixture work remains a separate deliverable.
- Keep D1–D5 unanswered unless the owner explicitly supplies answers. Approving this proposal does not authorize ingestion, a model switch or a phase acceptance exception.
- Carry the existing template-literal relative-import lint regression into the package-boundary work before new packages are added.

## Validation and limits

Reviewed the proposed spec against the current inference request/service, Phase 1 SQL/Drizzle schema, ADR 0002, embedding-storage contract, security/recovery contract and development handbook. Validation for this documentation revision is Markdown formatting, local-link/skill/command integrity and diff whitespace checks. No application code, SQL migration, dependency, runtime config or owner decision changed; no implementation issue, PR comment, commit, push or merge was created by this review.

Findings are design defects/omissions in the reviewed draft. The revised prose proposes their resolution; implementation tests and another reviewer must establish that the eventual code satisfies it.
