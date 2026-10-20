// Occurrence numbering for duplicate headings, and the staleness check an excerpt route runs
// before returning text: a citation resolves only against the exact identity it names.
import type { StructuredCitation } from './structured.ts';

type Sectioned = {
  readonly headingPath: readonly string[];
  readonly headingLine: number | undefined;
};

/**
 * For chunks of one document in source order, the occurrence of each chunk's heading path:
 * chunks of the same section share a number; a later section with an identical path gets the
 * next one. Chunks before the first heading are occurrence 1.
 */
export const headingOccurrences = (chunks: readonly Sectioned[]): number[] => {
  const seen = new Map<string, Set<number | undefined>>();
  return chunks.map((chunk) => {
    const key = JSON.stringify(chunk.headingPath);
    const sections = seen.get(key) ?? new Set<number | undefined>();
    sections.add(chunk.headingLine);
    seen.set(key, sections);
    return [...sections].indexOf(chunk.headingLine) + 1;
  });
};

// What the store currently holds for the cited chunk, looked up by chunk ID within the cited
// pinned version (undefined when that chunk/version no longer exists).
export type CurrentChunk = {
  readonly sourceId: string;
  readonly documentId: string;
  readonly path: string;
  readonly revision: number;
  readonly contentHash: string;
  readonly versionId: string;
  readonly deleted: boolean;
};

export type CitationCheck =
  | { readonly status: 'ok' }
  | { readonly status: 'out_of_scope' }
  | { readonly status: 'not_found' }
  | {
      readonly status: 'stale';
      readonly reason: 'revision' | 'content' | 'path' | 'deleted';
    };

/**
 * `allowedSources` is the caller's scope (e.g. the sources an MCP client may read). The check
 * never substitutes a newer revision: anything but an exact match is reported, not repaired.
 */
export const checkCitation = (
  citation: StructuredCitation,
  current: CurrentChunk | undefined,
  allowedSources: ReadonlySet<string>,
): CitationCheck => {
  if (!allowedSources.has(citation.sourceId)) return { status: 'out_of_scope' };
  if (
    !current ||
    current.sourceId !== citation.sourceId ||
    current.documentId !== citation.documentId ||
    current.versionId !== citation.versionId
  )
    return { status: 'not_found' };
  if (current.deleted) return { status: 'stale', reason: 'deleted' };
  if (current.revision !== citation.revision) return { status: 'stale', reason: 'revision' };
  if (current.contentHash !== citation.contentHash) return { status: 'stale', reason: 'content' };
  if (current.path !== citation.path) return { status: 'stale', reason: 'path' };
  return { status: 'ok' };
};
