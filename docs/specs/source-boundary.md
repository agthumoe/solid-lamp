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

Created from a resolved root, it captures the root's `realpath`, device and inode, and refuses filesystems outside an allowlist (ext4, btrfs, xfs, tmpfs, overlayfs). 9p (`/mnt/c`) is refused.

`open(relativePath)` returns the file's content, size and identity, or a typed refusal. The order is fixed:

1. **Path shape:** a root-relative POSIX path; no absolute path, NUL, backslash, empty segment, `.` or `..`. Rejected without touching the filesystem (`invalid_path`).
2. **Policy:** an excluded directory segment or a non-included extension is rejected before any filesystem call (`excluded`, `extension`).
3. **Root unchanged:** the root's realpath, device and inode still match; otherwise `root_changed`.
4. **Open:** `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`. A final-component symlink fails (`symlink`), and a FIFO cannot block the reader.
5. **Verify the opened object, not the path:** `fstat` must be a regular file (`not_regular_file`) with a single link (`hardlink`) and at most `max_file_bytes` (`too_large`, nothing read). Then the kernel path of the descriptor (`/proc/self/fd/<fd>`) must be under `rootReal + '/'` (`outside_root`). This check is on the object that will be read, so a swapped ancestor or root directory is caught even when the swap races the open.
6. **Read** from that descriptor only, bounded by size and `readTimeoutMs` (`timeout`). Content must be valid UTF-8 (`invalid_encoding`). The descriptor is always closed.

`list()` walks the root deterministically (sorted). It does not follow symlinked entries, skips excluded directories before descending, and keeps only included extensions. It is bounded by entry count and depth. Listing is advisory: every read still goes through `open`.

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
  - the root replaced by a symlink after creation;
  - a symlink/directory swap stress race in which no read ever returns outside content;
  - FIFO without blocking;
  - an oversized file not read;
  - a hardlink refused;
  - an unsupported filesystem refused;
  - invalid UTF-8;
  - a timeout;
  - `list()` skipping symlinks and excluded paths, and bounded.
