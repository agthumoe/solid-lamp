import { formatCitation } from '@aetherion/brain';
import type { BrainCitation } from '@aetherion/shared/contracts';

import type { ChunkDetail } from './ports.ts';

/**
 * The wire citation for a chunk at its indexed revision, or undefined when it cannot be cited
 * (a backfilled Phase 1 chunk without line ranges, or a path/heading the codec refuses). Such
 * chunks are dropped from results rather than cited inaccurately.
 */
export const citationFor = (detail: ChunkDetail, versionId: string): BrainCitation | undefined => {
  if (detail.lineStart === null || detail.lineEnd === null) return undefined;
  const identity = {
    sourceId: detail.sourceName,
    path: detail.path,
    headingPath: detail.headingPath,
    headingOccurrence: detail.headingPath.length ? detail.headingOccurrence : 1,
    lineStart: detail.lineStart,
    lineEnd: detail.lineEnd,
  };
  let display: string;
  try {
    display = formatCitation(identity);
  } catch {
    return undefined;
  }
  return {
    display,
    ...identity,
    headingPath: [...identity.headingPath],
    documentId: detail.documentId,
    revision: detail.revision,
    contentHash: detail.revisionHash,
    chunkId: detail.chunkId,
    versionId,
  };
};

// Cuts at a code-point boundary so a surrogate pair is never split.
export const bounded = (text: string, max: number): { text: string; truncated: boolean } => {
  if (text.length <= max) return { text, truncated: false };
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: text.slice(0, end), truncated: true };
};
