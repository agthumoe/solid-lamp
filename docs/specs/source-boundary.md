# Source configuration and verified path boundary

Issue: [#88](https://github.com/agthumoe/solid-lamp/issues/88) (P2-2). Status: implemented. Parent: [#4](https://github.com/agthumoe/solid-lamp/issues/4). Contracts: [security/recovery](security-recovery.md) Phase 2 (source path boundaries including traversal and symlink escape), AGENTS hard constraints 2 and 5. Plan: `docs/specs/brain.md` task 2 and review finding F3 ([PR #85](https://github.com/agthumoe/solid-lamp/pull/85)).

## Goal

Ingestion can read only regular files inside a configured source root. This holds even if a path, a parent directory or the root itself is swapped for a symlink while a file is being opened. Where containment cannot be guaranteed, reading is refused rather than downgraded.

## Non-goals

Watching, parsing and chunking (#93, #89, #90); repo sources (later); Windows mounts (`/mnt/c`, 9p), which are refused until a separate task proves containment there.

## `config/sources.yaml` (`parseSourcesConfig`, strict zod)

```yaml
sources:
  - id: fixture-vault
    kind: obsidian
    root: { repo_path: evals/brain/vault } # synthetic, inside the repo
    enabled: true
  - id: vault
    kind: obsidian
    root: { env: AETHERION_VAULT_ROOT } # the private path stays in .env
    enabled: false # real data stays off until owner D1/D2
```

- `id` is unique (`[a-z0-9-]`, 2–32 characters); `kind` is `obsidian` for now.
- `root` is either `{ env: AETHERION_* }` (the absolute path comes from the environment, so no private path is committed) or `{ repo_path }`, a relative path inside the repository (no `..`, not absolute).
- `enabled` defaults to `false`.
- `include_extensions` defaults to `['.md']`; `exclude_dirs` defaults to `['.obsidian', '.trash', 'AI-Inbox']`, matched as path segments at any depth.
- `max_file_bytes` defaults to 2 MiB, maximum 16 MiB.
- `resolveSourceRoot` returns an absolute path or a typed error (missing env, relative env path, repo path escape). Errors name keys, never values.

## Reader (`createSourceReader`, `packages/brain/src/sources`)

Created from a resolved root, it captures the root's `realpath`, device and inode, holds an `O_NOFOLLOW` descriptor on the root for its lifetime (released by `close()`), and refuses filesystems outside an allowlist (ext4, btrfs, xfs, tmpfs, overlayfs). 9p (`/mnt/c`) is refused.

`open(relativePath)` returns the file's content, size and identity, or a typed refusal. The order is fixed:

1. **Path shape:** a root-relative POSIX path; no absolute path, NUL, backslash, empty segment, `.` or `..`. Rejected without touching the filesystem (`invalid_path`).
2. **Policy:** an excluded directory segment or a non-included extension is rejected before any filesystem call (`excluded`, `extension`).
3. **Root unchanged:** the root's realpath, device and inode still match; otherwise `root_changed`.
4. **Open beneath the held root:** one component at a time, each relative to its parent's descriptor (`/proc/self/fd/<parent>/<name>`, an `openat` walk), with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`. A symlink at **any** component fails (`symlink`), so an alias such as `Alias -> .obsidian` cannot bypass exclusions; every intermediate must be a directory on the root's device. A FIFO cannot block the reader. Because the walk starts from the held root descriptor, replacing the root pathname cannot redirect it.
5. **Verify the opened object, not the path:** the root pathname must still be the held root (`root_changed`), and the kernel path of the descriptor (`/proc/self/fd/<fd>`) must equal `rootReal + '/' + relativePath` exactly (`outside_root`), so no component was moved or aliased. `fstat` must be a regular file (`not_regular_file`) with a single link (`hardlink`) and at most `max_file_bytes` (`too_large`, nothing read).
6. **Read** from that descriptor only, bounded by size and `readTimeoutMs` (`timeout`). Content must be valid UTF-8 (`invalid_encoding`). The descriptor is always closed.

`list()` returns a **complete, verified scan or throws**, never a partial list that could authorize resync deletions or tombstoning. It is sorted and bounded by entry count and depth (both throw).

- Each directory is opened one component at a time from its already-verified parent (`O_NOFOLLOW | O_DIRECTORY`). Its entries are read through its own descriptor (`/proc/self/fd/<fd>`), not by path.
- Symlinked entries are skipped and excluded directories pruned.
- The scan fails with `SourceScanError` when:
  - a directory becomes a symlink, a file or nothing before it is opened;
  - a directory's kernel path is no longer `root/<path>` after its entries are read (it was moved out of the vault);
  - the root pathname changes before or during the scan.
- Listing is still advisory: every read goes through `open`.

Refusals are counted by reason for `brain:stats`. Paths and reasons may be logged; file content never is.

## Acceptance tests

- Config: defaults, a disabled real source, unique IDs, unknown keys, env/repo root forms, env value missing or relative, repo path escape, error messages without values.
- Reader:
  - normal read;
  - traversal, absolute, NUL and backslash paths rejected without a filesystem call;
  - sibling-prefix confusion (`vault` vs `vault-evil`);
  - excluded directories and extensions;
  - a final symlink;
  - an ancestor directory symlink to outside;
  - an ancestor symlink into `.obsidian`, `AI-Inbox` or a user-excluded folder inside the root;
  - the root replaced between the root check and the open (interposed `open`);
  - the root replaced by a symlink after creation;
  - a symlink/directory swap stress race in which no read ever returns outside content;
  - FIFO without blocking;
  - an oversized file not read;
  - a hardlink refused;
  - an unsupported filesystem refused;
  - invalid UTF-8;
  - a timeout;
  - `list()` skipping symlinks and excluded paths, and bounded;
  - a depth-limited `list()` throws instead of returning a partial result;
  - listing races, each failing the scan with `SourceScanError`: a directory swapped for a symlink before it is opened; a directory moved out of the vault after it was opened; the review's exact reproduction (`notes` swapped for an outside symlink just before it is read); a root replaced mid-scan.
