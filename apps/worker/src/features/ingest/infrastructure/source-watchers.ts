// Vault watching for enabled sources (#93, #139). Events are hints: each batch is re-observed
// through the verified reader and recorded as durable events; a nameless/folder event or a watch
// error requests a resync (and the watcher is recreated after an error). Nothing is published
// here; the relay dispatches the events as jobs.
import { createVaultWatcher, observePaths, type VaultWatcher } from '@aetherion/brain';
import type { Logger, SourcesConfig } from '@aetherion/shared';

import {
  isTransientRefusal,
  type ChangeEvent,
  type IngestStore,
  type SourceReaders,
} from '../application/ports.ts';

const RESTART_MS = 5_000;

export const startSourceWatchers = async (deps: {
  readonly config: SourcesConfig;
  readonly readers: SourceReaders;
  readonly store: IngestStore;
  readonly logger: Logger;
}): Promise<{ readonly close: () => void }> => {
  const watchers: VaultWatcher[] = [];
  const timers = new Set<NodeJS.Timeout>();
  let closed = false;

  const watch = async (source: SourcesConfig['sources'][number]) => {
    const reader = await deps.readers(source.id);
    if (!reader || closed) return;
    const sourceId = await deps.store.ensureSource(source.id, AbortSignal.timeout(10_000));
    const record = (events: readonly ChangeEvent[]) =>
      deps.store.recordEvents(sourceId, events, AbortSignal.timeout(10_000)).catch(() => {
        deps.logger.warn({ event: 'ingest.watch_record', outcome: 'failed', errorCode: 'DB' });
        return 0;
      });
    const watcher = createVaultWatcher({
      root: reader.root,
      includeExtensions: source.include_extensions,
      excludeDirs: source.exclude_dirs,
      onBatch: (paths) => {
        void observePaths(reader, paths).then((observations) =>
          record(
            observations.flatMap((o): ChangeEvent[] => {
              if (o.kind === 'present')
                return [{ kind: 'changed', path: o.path, observedHash: o.revision }];
              // A transient refusal proves nothing; the next event or resync re-checks the path.
              if (o.kind === 'refused' && isTransientRefusal(o.reason)) return [];
              return [{ kind: 'deleted', path: o.path }];
            }),
          ),
        );
      },
      onResyncRequired: (reason) => {
        void deps.store.requestResync(sourceId, AbortSignal.timeout(10_000)).catch(() => undefined);
        if (reason === 'watch_error' && !closed) {
          const timer = setTimeout(() => {
            timers.delete(timer);
            void watch(source);
          }, RESTART_MS);
          timers.add(timer);
        }
      },
    });
    watchers.push(watcher);
  };

  for (const source of deps.config.sources.filter((candidate) => candidate.enabled))
    await watch(source);
  return {
    close: () => {
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
    },
  };
};
