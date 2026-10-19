// Verified root-relative reader for ingestion sources (#88, docs/specs/source-boundary.md).
// The check is on the opened descriptor, not the path string: after an O_NOFOLLOW open, the
// kernel's path for that descriptor must be under the root, so a swapped ancestor or root
// directory is caught even when the swap races the open. Content is never logged.
import { constants, type Stats } from 'node:fs';
import { open, readdir, readlink, realpath, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';

export type RefusalReason =
  | 'invalid_path'
  | 'excluded'
  | 'extension'
  | 'root_changed'
  | 'not_found'
  | 'symlink'
  | 'not_regular_file'
  | 'hardlink'
  | 'too_large'
  | 'outside_root'
  | 'timeout'
  | 'invalid_encoding'
  | 'unreadable';

export type SourceFile = {
  readonly relativePath: string;
  readonly content: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly dev: number;
  readonly ino: number;
};

export type OpenResult =
  | { readonly ok: true; readonly file: SourceFile }
  | { readonly ok: false; readonly reason: RefusalReason; readonly relativePath: string };

export type SourceReaderOptions = {
  readonly root: string;
  readonly includeExtensions: readonly string[];
  readonly excludeDirs: readonly string[];
  readonly maxFileBytes: number;
  readonly readTimeoutMs?: number;
  readonly maxListEntries?: number;
  readonly maxDepth?: number;
  // Injected for tests: returns the statfs `type` magic of a path.
  readonly filesystemType?: (path: string) => Promise<number>;
};

// ext4, btrfs, xfs, tmpfs, overlayfs. 9p (WSL's /mnt/c) is refused: containment there is
// not established (review F3).
const SUPPORTED_FILESYSTEMS = new Set([0xef53, 0x9123683e, 0x58465342, 0x01021994, 0x794c7630]);

const OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

export class UnsupportedSourceError extends Error {}

/** Root-relative POSIX path with no traversal, absolute, empty or NUL parts. */
export const isSafeRelativePath = (path: string): boolean =>
  path.length > 0 &&
  path.length <= 4096 &&
  !path.startsWith('/') &&
  !path.includes('\\') &&
  !path.includes('\0') &&
  path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

/** True when `child` is `root` itself or below it, comparing whole path segments. */
export const isWithin = (root: string, child: string): boolean =>
  child === root || child.startsWith(root.endsWith('/') ? root : `${root}/`);

const extensionOf = (path: string) => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

export const createSourceReader = async (options: SourceReaderOptions) => {
  const rootReal = await realpath(options.root);
  const rootStat = await stat(rootReal);
  if (!rootStat.isDirectory()) throw new UnsupportedSourceError('source root is not a directory');
  const fsType = await (options.filesystemType ?? (async (p: string) => (await statfs(p)).type))(
    rootReal,
  );
  if (!SUPPORTED_FILESYSTEMS.has(fsType))
    throw new UnsupportedSourceError(
      `source root filesystem 0x${fsType.toString(16)} is not supported for verified reads`,
    );
  const excluded = new Set(options.excludeDirs);
  const included = new Set(options.includeExtensions.map((ext) => ext.toLowerCase()));
  const timeoutMs = options.readTimeoutMs ?? 5_000;
  const refusals = new Map<RefusalReason, number>();

  const refuse = (relativePath: string, reason: RefusalReason): OpenResult => {
    refusals.set(reason, (refusals.get(reason) ?? 0) + 1);
    return { ok: false, reason, relativePath };
  };

  const policy = (relativePath: string): RefusalReason | undefined => {
    if (!isSafeRelativePath(relativePath)) return 'invalid_path';
    const parts = relativePath.split('/');
    if (parts.slice(0, -1).some((part) => excluded.has(part))) return 'excluded';
    if (!included.has(extensionOf(relativePath))) return 'extension';
    return undefined;
  };

  const rootUnchanged = async () => {
    try {
      const current = await stat(options.root);
      return (
        (await realpath(options.root)) === rootReal &&
        current.dev === rootStat.dev &&
        current.ino === rootStat.ino
      );
    } catch {
      return false;
    }
  };

  const open_ = async (relativePath: string): Promise<OpenResult> => {
    const blocked = policy(relativePath);
    if (blocked) return refuse(relativePath, blocked);
    if (!(await rootUnchanged())) return refuse(relativePath, 'root_changed');

    let handle;
    try {
      handle = await open(join(rootReal, relativePath), OPEN_FLAGS);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ELOOP') return refuse(relativePath, 'symlink');
      if (code === 'ENOENT' || code === 'ENOTDIR') return refuse(relativePath, 'not_found');
      return refuse(relativePath, 'unreadable');
    }
    try {
      const info: Stats = await handle.stat();
      if (!info.isFile()) return refuse(relativePath, 'not_regular_file');
      if (info.nlink !== 1) return refuse(relativePath, 'hardlink');
      if (info.size > options.maxFileBytes) return refuse(relativePath, 'too_large');
      // The kernel's path for this exact descriptor: the object we would read.
      const opened = await readlink(`/proc/self/fd/${handle.fd}`);
      if (!isWithin(rootReal, opened) || opened === rootReal)
        return refuse(relativePath, 'outside_root');

      const buffer = Buffer.alloc(info.size);
      const deadline = AbortSignal.timeout(timeoutMs);
      let offset = 0;
      while (offset < info.size) {
        if (deadline.aborted) return refuse(relativePath, 'timeout');
        const { bytesRead } = await handle.read(buffer, offset, info.size - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset));
      } catch {
        return refuse(relativePath, 'invalid_encoding');
      }
      return {
        ok: true,
        file: {
          relativePath,
          content,
          size: offset,
          mtimeMs: info.mtimeMs,
          dev: info.dev,
          ino: info.ino,
        },
      };
    } finally {
      await handle.close();
    }
  };

  /** Deterministic advisory listing; symlinked entries are never followed. */
  const list = async (): Promise<string[]> => {
    const maxEntries = options.maxListEntries ?? 200_000;
    const maxDepth = options.maxDepth ?? 32;
    const found: string[] = [];
    let seen = 0;
    const walk = async (relativeDir: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return;
      const entries = await readdir(join(rootReal, relativeDir), { withFileTypes: true });
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        if (++seen > maxEntries) throw new UnsupportedSourceError('source exceeds the entry limit');
        const path = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (!excluded.has(entry.name)) await walk(path, depth + 1);
        } else if (entry.isFile() && policy(path) === undefined) found.push(path);
      }
    };
    await walk('', 0);
    return found;
  };

  return {
    root: rootReal,
    open: open_,
    list,
    refusals: (): Readonly<Partial<Record<RefusalReason, number>>> => Object.fromEntries(refusals),
  };
};

export type SourceReader = Awaited<ReturnType<typeof createSourceReader>>;
