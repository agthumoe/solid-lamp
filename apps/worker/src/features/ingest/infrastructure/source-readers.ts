// Verified readers for the sources enabled in sources.yaml (#88). A disabled or unknown source
// has no reader, so nothing can be read from it (D2: the real vault stays off until approved).
import { createSourceReader, type SourceReader } from '@aetherion/brain';
import { resolveSourceRoot, type SourcesConfig } from '@aetherion/shared';

import type { SourceReaders } from '../application/ports.ts';

export const createSourceReaders = (
  config: SourcesConfig,
  env: Readonly<Record<string, string | undefined>>,
  repoRoot: string,
): SourceReaders & { readonly close: () => Promise<void>; readonly enabled: () => string[] } => {
  const readers = new Map<string, Promise<SourceReader | undefined>>();
  const enabled = config.sources.filter((source) => source.enabled);
  const open = (name: string) => {
    const source = enabled.find((candidate) => candidate.id === name);
    if (!source) return Promise.resolve(undefined);
    const root = resolveSourceRoot(source, env, repoRoot);
    if (!root.ok) return Promise.resolve(undefined);
    return createSourceReader({
      root: root.value,
      includeExtensions: source.include_extensions,
      excludeDirs: source.exclude_dirs,
      maxFileBytes: source.max_file_bytes,
    }).catch(() => undefined);
  };
  const get = (name: string) => {
    let reader = readers.get(name);
    if (!reader) {
      reader = open(name);
      readers.set(name, reader);
    }
    return reader;
  };
  return Object.assign(get, {
    enabled: () => enabled.map((source) => source.id),
    close: async () => {
      for (const reader of readers.values()) await (await reader)?.close();
      readers.clear();
    },
  });
};
