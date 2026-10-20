// Verified root-relative reader for ingestion sources (#88, docs/specs/source-boundary.md).
// Traversal starts from a descriptor held on the approved root and opens one component at a
// time with O_NOFOLLOW (an openat walk through /proc/self/fd), so neither a swapped root nor
// a symlinked ancestor can redirect it. The opened descriptor's kernel path is then checked
// to be exactly root + relative path. Content is never logged.
import { constants, type Stats } from 'node:fs';
import { open, readdir, readlink, realpath, stat, statfs, type FileHandle } from 'node:fs/promises';

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
const DIRECTORY_FLAGS = OPEN_FLAGS | constants.O_DIRECTORY;

export class UnsupportedSourceError extends Error {}

// A listing that raced a change in the tree. Never treat it as a complete scan.
export class SourceScanError extends Error {}

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
  // Held for the reader's lifetime: every open and listing is relative to this exact directory.
  const rootHandle = await open(rootReal, OPEN_FLAGS | constants.O_DIRECTORY);
  const held = await rootHandle.stat();
  if (held.dev !== rootStat.dev || held.ino !== rootStat.ino) {
    await rootHandle.close();
    throw new UnsupportedSourceError('source root changed during creation');
  }
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

  // Opens each component relative to its parent's descriptor, never following a symlink.
  // Every intermediate must be a directory on the root's device.
  const openBeneathRoot = async (relativePath: string): Promise<FileHandle | RefusalReason> => {
    const parts = relativePath.split('/');
    const opened: FileHandle[] = [];
    let parent = rootHandle;
    try {
      for (const [index, part] of parts.entries()) {
        const handle = await open(`/proc/self/fd/${parent.fd}/${part}`, OPEN_FLAGS);
        if (index === parts.length - 1) return handle;
        opened.push(handle);
        const info = await handle.stat();
        if (!info.isDirectory()) return 'not_found';
        if (info.dev !== rootStat.dev) return 'outside_root';
        parent = handle;
      }
      return 'not_found';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ELOOP') return 'symlink';
      if (code === 'ENOENT' || code === 'ENOTDIR') return 'not_found';
      return 'unreadable';
    } finally {
      await Promise.all(opened.map((handle) => handle.close()));
    }
  };

  const open_ = async (relativePath: string): Promise<OpenResult> => {
    const blocked = policy(relativePath);
    if (blocked) return refuse(relativePath, blocked);
    if (!(await rootUnchanged())) return refuse(relativePath, 'root_changed');

    const handle = await openBeneathRoot(relativePath);
    if (typeof handle === 'string') return refuse(relativePath, handle);
    try {
      // The approved root must still be at its path, and the kernel's path for this exact
      // descriptor must be root + the requested path: no component was moved or aliased.
      if (!(await rootUnchanged())) return refuse(relativePath, 'root_changed');
      const opened = await readlink(`/proc/self/fd/${handle.fd}`);
      if (opened !== `${rootReal}/${relativePath}`) return refuse(relativePath, 'outside_root');
      const info: Stats = await handle.stat();
      if (!info.isFile()) return refuse(relativePath, 'not_regular_file');
      if (info.nlink !== 1) return refuse(relativePath, 'hardlink');
      if (info.size > options.maxFileBytes) return refuse(relativePath, 'too_large');

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

  /**
   * Deterministic advisory listing; symlinked entries are never followed. A listing that would
   * exceed the entry or depth bound throws: a truncated scan must never look complete.
   */
  /**
   * Complete, verified scan or an error, never a partial list that could authorize resync
   * deletions. Every directory is opened one component at a time from its verified parent
   * (O_NOFOLLOW | O_DIRECTORY) and read through its own descriptor, so a directory swapped for
   * a symlink mid-scan fails the scan instead of listing what the link points at. A root
   * pathname replacement before or during the scan fails it too.
   */
  const list = async (): Promise<string[]> => {
    const maxEntries = options.maxListEntries ?? 200_000;
    const maxDepth = options.maxDepth ?? 32;
    const found: string[] = [];
    let seen = 0;
    const raced = (path: string) =>
      new SourceScanError(`source changed during listing at ${path || '<root>'}`);

    const openChildDirectory = async (parent: FileHandle, name: string, path: string) => {
      let handle: FileHandle;
      try {
        handle = await open(`/proc/self/fd/${parent.fd}/${name}`, DIRECTORY_FLAGS);
      } catch {
        // ELOOP (now a symlink), ENOTDIR (now a file), ENOENT (gone): the scan is not
        // describing one consistent tree.
        throw raced(path);
      }
      try {
        const info = await handle.stat();
        const actual = await readlink(`/proc/self/fd/${handle.fd}`);
        if (!info.isDirectory() || info.dev !== rootStat.dev || actual !== `${rootReal}/${path}`)
          throw raced(path);
        return handle;
      } catch (error) {
        await handle.close();
        throw error;
      }
    };

    const walk = async (
      directory: FileHandle,
      relativeDir: string,
      depth: number,
    ): Promise<void> => {
      if (depth > maxDepth) throw new UnsupportedSourceError('source exceeds the depth limit');
      // Reads exactly the directory this descriptor refers to, not whatever a path names now.
      const entries = await readdir(`/proc/self/fd/${directory.fd}`, { withFileTypes: true });
      // A directory moved out of the vault after it was opened would list outside entries.
      const expected = relativeDir ? `${rootReal}/${relativeDir}` : rootReal;
      if ((await readlink(`/proc/self/fd/${directory.fd}`)) !== expected) throw raced(relativeDir);
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        if (++seen > maxEntries) throw new UnsupportedSourceError('source exceeds the entry limit');
        const path = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (excluded.has(entry.name)) continue;
          const child = await openChildDirectory(directory, entry.name, path);
          try {
            await walk(child, path, depth + 1);
          } finally {
            await child.close();
          }
        } else if (entry.isFile() && policy(path) === undefined) found.push(path);
      }
    };

    if (!(await rootUnchanged())) throw raced('');
    await walk(rootHandle, '', 0);
    if (!(await rootUnchanged())) throw raced('');
    return found;
  };

  return {
    root: rootReal,
    open: open_,
    list,
    refusals: (): Readonly<Partial<Record<RefusalReason, number>>> => Object.fromEntries(refusals),
    close: () => rootHandle.close(),
  };
};

export type SourceReader = Awaited<ReturnType<typeof createSourceReader>>;
