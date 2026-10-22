// Narrow ports for the brain use cases (#95). Adapters: infrastructure/postgres-brain-store.ts and
// infrastructure/inference-query-embedder.ts. Use cases never see SQL or HTTP.
import type { EvidenceGates } from '@aetherion/brain';
import type { AppError, Result } from '@aetherion/shared';

export type PinnedVersion = {
  readonly versionId: string;
  readonly profileId: string;
  readonly profileDigest: string;
  readonly dimensions: number;
  readonly chunkerVersion: string;
  readonly promotedAt: Date;
  // Frozen gates for this version; null when it was never calibrated (search fails closed).
  readonly gates: EvidenceGates | null;
};

export type SearchFilters = {
  readonly sourceIds: readonly string[];
  readonly tags: readonly string[];
  readonly tagsAll: boolean;
  readonly pathPrefix: string | null;
};

export type Candidate = {
  readonly chunkId: string;
  readonly vectorRank: number | null;
  readonly lexicalRank: number | null;
  readonly cosine: number | null;
  readonly lexical: number | null;
  readonly fused: number;
};

// Everything needed to cite one chunk at the revision it was indexed from.
export type ChunkDetail = {
  readonly chunkId: string;
  readonly documentId: string;
  readonly sourceName: string;
  readonly path: string;
  readonly title: string;
  readonly revision: number;
  readonly revisionHash: string;
  readonly headingPath: readonly string[];
  readonly headingOccurrence: number;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
  readonly content: string;
};

export type CurrentNoteState = {
  readonly detail: ChunkDetail;
  readonly deleted: boolean;
  readonly currentRevision: number;
  readonly currentRevisionHash: string | null;
  readonly currentPath: string;
};

export type BrainStats = {
  readonly activeVersion: Omit<PinnedVersion, 'gates' | 'profileId' | 'profileDigest'> | null;
  readonly documents: number;
  readonly chunks: number;
  readonly embeddedChunks: number;
  readonly sources: readonly {
    readonly name: string;
    readonly documents: number;
    readonly lastIngestAt: Date | null;
    readonly lastScan: 'complete' | 'incomplete' | 'never';
  }[];
};

export type BrainStore = {
  readonly pinActiveVersion: (signal: AbortSignal) => Promise<PinnedVersion | null>;
  readonly sourceIdsByName: (names: readonly string[], signal: AbortSignal) => Promise<string[]>;
  readonly searchCandidates: (
    input: {
      readonly versionId: string;
      readonly queryVector: readonly number[] | null;
      readonly queryText: string;
      readonly filters: SearchFilters;
      readonly branchLimit: number;
      readonly resultLimit: number;
    },
    signal: AbortSignal,
  ) => Promise<Candidate[]>;
  readonly chunkDetails: (
    chunkIds: readonly string[],
    signal: AbortSignal,
  ) => Promise<ChunkDetail[]>;
  // True when every live document's current revision is selected and fully embedded.
  readonly corpusComplete: (versionId: string, signal: AbortSignal) => Promise<boolean>;
  // The cited chunk within the cited version, scoped to enabled sources; null when not found.
  readonly noteState: (
    identity: {
      readonly sourceName: string;
      readonly documentId: string;
      readonly chunkId: string;
      readonly versionId: string;
    },
    signal: AbortSignal,
  ) => Promise<CurrentNoteState | null>;
  readonly stats: (signal: AbortSignal) => Promise<BrainStats>;
};

export type QueryEmbedding = {
  readonly vector: readonly number[];
  readonly profileId: string;
  readonly digest: string;
  readonly dimensions: number;
};

export type QueryEmbedder = (
  query: string,
  profileId: string,
  signal: AbortSignal,
) => Promise<Result<QueryEmbedding, AppError<'UNAVAILABLE'>>>;
