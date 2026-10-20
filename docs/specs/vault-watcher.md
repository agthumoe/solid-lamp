# Vault watcher and change planning

Issue: [#93](https://github.com/agthumoe/solid-lamp/issues/93) (P2-7). Status: implemented (watcher, change planner, detection latency); end-to-end write → searchable latency and worker wiring follow with #91/#95. Parent: [#4](https://github.com/agthumoe/solid-lamp/issues/4). Builds on: [source boundary](source-boundary.md) (#88), [worker](worker.md) (#92). Plan: [brain](brain.md) task 7 and review findings F4/F5.

## Goal

Notice note edits quickly and turn them into a precise, conservative change plan. A missed event, a duplicate note or a partial scan must never delete indexed content that still exists.

## Non-goals

Publishing (needs the revision schema, #91), embedding (#94), and the end-to-end write → searchable latency (needs search, #95). `/mnt/c` is refused by the reader.

## Decision: `fs.watch`, events as hints

The watcher uses Node's built-in recursive `fs.watch` (inotify on Linux) rather than chokidar, so no new dependency is added. Events are **hints, never facts**. Every candidate path is confirmed through the verified reader (#88), which decides what exists and what its bytes are. A missed or wrong event is therefore at worst a delay, and resync is the safety net.

## Watcher (`createVaultWatcher`)

- A candidate is a safe relative path with an included extension outside excluded folders. Each candidate is debounced until its **write is stable**: no events for `quietMs` (default 300 ms) and the same size and mtime on two consecutive checks. A path that never settles is emitted after `maxSettleMs` (default 10 s). A path that disappears is emitted too, so the reader can confirm the deletion.
- Ready paths are flushed in batches after `batchMs` (default 100 ms) or at 500 paths.
- **Resync is requested** (coalesced) for:
  - an event with no file name;
  - a path that is not a candidate but is not excluded either (for example a folder: a folder rename reports only the folder, not its files);
  - a watch error (inotify limit, root removed).

  After a watch error the watcher stops; the caller recreates it after the resync.

- Excluded folders (`.obsidian`, `.trash`, `AI-Inbox`, configured) and unsafe paths are ignored.

## Observation and planning (pure)

`observePaths(reader, paths)` returns `SourceObservation`s. It reads each path through the reader. A `present` observation carries the revision (SHA-256 of the exact bytes), `missing` means the reader reported `not_found`, and `refused` carries the reason. `scanSource(reader)` lists the source and observes every listed path. It returns `complete: true` only when `list()` succeeded; a raced or limited scan returns `complete: false` with the error.

`planChanges(indexed, observations, { complete })`, where `indexed` maps known paths to revisions:

- **Added** for a present path that is not indexed; **modified** for a present path with a different revision; **unchanged** otherwise. Frontmatter-only and newline-only edits change the bytes, so they are modifications.
- **Deleted** only for a confirmed `missing` path, or, when `complete` is true, for an indexed path the scan did not see. A partial or failed scan never deletes.
- **Renamed or moved** only when a revision appears exactly once among this plan's deletions, exactly once among its additions, and in no other indexed or observed path. Duplicate notes and ambiguous pairs stay delete + add, because identical content does not prove a rename.
- **Refused** paths (a file became a symlink, too large, invalid UTF-8) are reported, never silently deleted, so they surface in `brain:stats`.
- Output is sorted.

## Detection latency (`pnpm run brain:watch-latency`)

The latency script runs a synthetic temporary vault. It measures from the end of a write (file closed) to the planned change, covering stability wait, batching, a verified read and planning. It reports p50/p95/max for idle single edits and for a 100-file burst. This is detection latency only; the brain plan's < 5 s target is end to end and is measured once search exists (#95).

Measured 2026-10-20 (WSL ext4, `quietMs` 300):

| Scenario         | n   | p50    | p95    | max    |
| ---------------- | --- | ------ | ------ | ------ |
| Idle single edit | 20  | 705 ms | 711 ms | 711 ms |
| 100-file burst   | 100 | 736 ms | 756 ms | 759 ms |

Most of this is the deliberate stable-write wait (two quiet checks); lowering `quietMs` trades latency for more reads of half-written files.

## Acceptance tests

- **Planner:**
  - add, modify and unchanged;
  - frontmatter-only and newline-only edits;
  - a confirmed missing path deleted;
  - a complete scan deleting unseen paths while a partial scan does not;
  - a unique rename and a cross-folder move;
  - ambiguity cases: two deletions with the same revision, two additions with the same revision, and another indexed path sharing the revision;
  - refused paths not deleted;
  - deterministic output.
- **Watcher** (an injected watch source and stat, with real short timers):
  - bursts coalesce per path;
  - an unstable size delays emission;
  - `maxSettleMs` bound;
  - a disappearing file is emitted;
  - excluded and unsafe paths are ignored;
  - folder-like paths and a missing file name request resync;
  - an error requests resync and stops;
  - `close()` clears timers.
- **Real filesystem:** write, edit, rename and delete in a temporary vault produce the expected plan through the real reader.
