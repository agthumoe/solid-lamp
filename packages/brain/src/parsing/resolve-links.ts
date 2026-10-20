import { fileStem, localTarget, validSourcePath } from './paths.ts';
import type { LinkCandidate, LinkResolution, ParsedLink, ParsedNote } from './types.ts';

const pathVariants = (path: string): readonly string[] =>
  path.endsWith('.md') ? [path] : [path, `${path}.md`];

const pick = (
  link: ParsedLink,
  candidates: readonly LinkCandidate[],
  via: 'path' | 'filename' | 'alias',
): LinkResolution | undefined => {
  const unique = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
  if (!unique.length) return undefined;
  const candidate = unique[0];
  return unique.length === 1 && candidate
    ? { link, status: 'resolved', documentId: candidate.id, via }
    : { link, status: 'ambiguous' };
};

export const resolveNoteLinks = (
  note: ParsedNote,
  input: readonly LinkCandidate[],
): LinkResolution[] => {
  const candidates = input.filter(
    (candidate) => candidate.sourceId === note.sourceId && validSourcePath(candidate.path),
  );
  const directory = note.path.split('/').slice(0, -1).join('/');
  return note.links.map((link): LinkResolution => {
    const target = link.targetPath;
    if (!target)
      return (
        pick(
          link,
          candidates.filter((candidate) => candidate.path === note.path),
          'path',
        ) ?? { link, status: 'unresolved' }
      );
    const relative = localTarget(target, directory);
    if (!relative) return { link, status: 'unresolved' };
    const root = localTarget(target);
    for (const path of [relative, ...(root ? [root] : [])].flatMap(pathVariants)) {
      const exact = pick(
        link,
        candidates.filter((candidate) => candidate.path === path),
        'path',
      );
      if (exact) return exact;
    }
    // An explicit path must not degrade into a basename/alias match after a miss.
    if (target.includes('/')) return { link, status: 'unresolved' };
    return (
      pick(
        link,
        candidates.filter((candidate) => fileStem(candidate.path) === fileStem(target)),
        'filename',
      ) ??
      pick(
        link,
        candidates.filter((candidate) => candidate.aliases.includes(target)),
        'alias',
      ) ?? { link, status: 'unresolved' }
    );
  });
};
