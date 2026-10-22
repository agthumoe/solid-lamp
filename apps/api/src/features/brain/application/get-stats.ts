import type { BrainStatsResponse } from '@aetherion/shared/contracts';

import type { BrainStore } from './ports.ts';

// Index status for the active version. Counts only; never paths or note text.
export const getStats = async (
  store: BrainStore,
  signal: AbortSignal,
): Promise<BrainStatsResponse> => {
  const stats = await store.stats(signal);
  const version = stats.activeVersion;
  return {
    activeVersion: version
      ? {
          id: version.versionId,
          embedRole: 'embed',
          dimensions: version.dimensions,
          chunkerVersion: version.chunkerVersion,
          promotedAt: version.promotedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        }
      : null,
    documents: stats.documents,
    chunks: stats.chunks,
    embeddedChunks: stats.embeddedChunks,
    corpus:
      stats.documents === 0
        ? 'empty'
        : version && stats.chunks > 0 && stats.embeddedChunks >= stats.chunks
          ? 'complete'
          : 'incomplete',
    sources: stats.sources.map((source) => ({
      id: source.name,
      documents: source.documents,
      lastIngestAt: source.lastIngestAt
        ? source.lastIngestAt.toISOString().replace(/\.\d{3}Z$/, 'Z')
        : null,
      lastScan: source.lastScan,
    })),
  };
};
