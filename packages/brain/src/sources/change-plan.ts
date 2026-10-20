// Conservative change planning (#93, docs/specs/vault-watcher.md, review F5). Pure: the
// reader decides what exists; this decides what changed, and never deletes on a partial view.
import type { RefusalReason } from './source-reader.ts';

export type SourceObservation =
  | { readonly kind: 'present'; readonly path: string; readonly revision: string }
  | { readonly kind: 'missing'; readonly path: string }
  | { readonly kind: 'refused'; readonly path: string; readonly reason: RefusalReason };

export type ChangePlan = {
  readonly added: readonly { readonly path: string; readonly revision: string }[];
  readonly modified: readonly {
    readonly path: string;
    readonly revision: string;
    readonly previous: string;
  }[];
  readonly deleted: readonly { readonly path: string; readonly previous: string }[];
  readonly renamed: readonly {
    readonly from: string;
    readonly to: string;
    readonly revision: string;
  }[];
  readonly unchanged: readonly string[];
  readonly refused: readonly { readonly path: string; readonly reason: RefusalReason }[];
};

export type PlanOptions = {
  // True only when the observations come from a successful, complete list() of the source.
  readonly complete: boolean;
};

const byPath = <T extends { readonly path: string }>(a: T, b: T) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

export const planChanges = (
  indexed: ReadonlyMap<string, string>,
  observations: readonly SourceObservation[],
  options: PlanOptions,
): ChangePlan => {
  const seen = new Map<string, SourceObservation>();
  for (const observation of observations) seen.set(observation.path, observation);

  const added: { path: string; revision: string }[] = [];
  const modified: { path: string; revision: string; previous: string }[] = [];
  const deleted: { path: string; previous: string }[] = [];
  const unchanged: string[] = [];
  const refused: { path: string; reason: RefusalReason }[] = [];

  for (const observation of seen.values()) {
    const previous = indexed.get(observation.path);
    if (observation.kind === 'present') {
      if (previous === undefined)
        added.push({ path: observation.path, revision: observation.revision });
      else if (previous === observation.revision) unchanged.push(observation.path);
      else modified.push({ path: observation.path, revision: observation.revision, previous });
    } else if (observation.kind === 'missing') {
      if (previous !== undefined) deleted.push({ path: observation.path, previous });
    } else {
      refused.push({ path: observation.path, reason: observation.reason });
    }
  }
  // Only a complete scan may infer that an unseen indexed path is gone.
  if (options.complete)
    for (const [path, previous] of indexed) if (!seen.has(path)) deleted.push({ path, previous });

  // A rename needs a revision that is unique on both sides and shared with nothing else:
  // identical content in two notes does not prove that one was renamed.
  const count = (values: Iterable<string>) => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  };
  const deletedRevisions = count(deleted.map((entry) => entry.previous));
  const addedRevisions = count(added.map((entry) => entry.revision));
  const deletedPaths = new Set(deleted.map((entry) => entry.path));
  const addedPaths = new Set(added.map((entry) => entry.path));
  const elsewhere = count([
    ...[...indexed].filter(([path]) => !deletedPaths.has(path)).map(([, revision]) => revision),
    ...[...seen.values()]
      .filter((o): o is Extract<SourceObservation, { kind: 'present' }> => o.kind === 'present')
      .filter((o) => !addedPaths.has(o.path) && indexed.get(o.path) !== o.revision)
      .map((o) => o.revision),
  ]);
  const renamed: { from: string; to: string; revision: string }[] = [];
  for (const removal of [...deleted]) {
    const revision = removal.previous;
    if (deletedRevisions.get(revision) !== 1 || addedRevisions.get(revision) !== 1) continue;
    if ((elsewhere.get(revision) ?? 0) > 0) continue;
    const target = added.find((entry) => entry.revision === revision);
    if (!target) continue;
    renamed.push({ from: removal.path, to: target.path, revision });
    deleted.splice(deleted.indexOf(removal), 1);
    added.splice(added.indexOf(target), 1);
  }

  return {
    added: added.sort(byPath),
    modified: modified.sort(byPath),
    deleted: deleted.sort(byPath),
    renamed: renamed.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)),
    unchanged: unchanged.sort(),
    refused: refused.sort(byPath),
  };
};
