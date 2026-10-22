// Ports for the ingestion use cases (#139). Adapters: infrastructure/postgres-ingest-store.ts,
// infrastructure/source-readers.ts and infrastructure/inference-document-embedder.ts.
import type { RefusalReason, SourceReader } from '@aetherion/brain';

// Refusals that do not prove the file is gone or ineligible: a temporary filesystem problem or a
// race. They must never publish a tombstone; the work is retried instead.
const TRANSIENT_REFUSALS: ReadonlySet<RefusalReason> = new Set([
  'root_changed',
  'outside_root',
  'timeout',
  'unreadable',
]);
export const isTransientRefusal = (reason: RefusalReason): boolean =>
  TRANSIENT_REFUSALS.has(reason);

export type DocumentState = {
  readonly documentId: string;
  readonly currentRevisionId: string | null;
  readonly currentRevision: number;
  readonly currentHash: string | null;
  readonly deleted: boolean;
};

export type RevisionChunk = {
  readonly ordinal: number;
  readonly content: string;
  readonly contentHash: string;
  readonly headingPath: readonly string[];
  readonly tokenCount: number;
  readonly lineStart: number;
  readonly lineEnd: number;
  // The chunker's section identity, stored in chunks.metadata for citations (#137).
  readonly headingLine: number | null;
  readonly headingOccurrence: number;
};

export type RevisionLink = {
  readonly kind: 'wikilink' | 'import';
  readonly toTitle: string;
  readonly targetPath: string;
};

export type NewRevision = {
  readonly sourceId: string; // database id
  readonly path: string;
  readonly expectedRevisionId: string | null;
  readonly revision: number;
} & (
  | { readonly kind: 'tombstone' }
  | {
      readonly kind: 'content';
      readonly title: string;
      readonly tags: readonly string[];
      readonly frontmatter: Readonly<Record<string, unknown>>;
      readonly contentHash: string;
      readonly chunkerVersion: string;
      readonly chunks: readonly RevisionChunk[];
      readonly links: readonly RevisionLink[];
    }
);

export type ChangeEvent =
  | { readonly kind: 'changed'; readonly path: string; readonly observedHash: string }
  | { readonly kind: 'deleted'; readonly path: string };

export type VersionTarget = {
  readonly versionId: string;
  readonly profileId: string;
  readonly dimensions: number;
};

export type MissingVector = {
  readonly chunkId: string;
  readonly content: string;
  readonly contentHash: string;
};

export type ScanRecord = {
  readonly complete: boolean;
  readonly seen: number;
  readonly indexed: number;
  readonly skipped: number;
  readonly errorCode: string | null;
};

export type IngestStore = {
  readonly ensureSource: (name: string, signal: AbortSignal) => Promise<string>;
  readonly documentState: (
    sourceId: string,
    path: string,
    signal: AbortSignal,
  ) => Promise<DocumentState | null>;
  // One transaction: document row (if new), immutable revision/set/chunks/links, then the
  // brain_publish_revision compare-and-set. `superseded` means a newer revision won.
  readonly publish: (
    revision: NewRevision,
    signal: AbortSignal,
  ) => Promise<'published' | 'superseded'>;
  // Live documents' current revision hashes by path, for resync planning.
  readonly indexedPaths: (
    sourceId: string,
    signal: AbortSignal,
  ) => Promise<ReadonlyMap<string, string>>;
  readonly recordEvents: (
    sourceId: string,
    events: readonly ChangeEvent[],
    signal: AbortSignal,
  ) => Promise<number>;
  readonly requestResync: (sourceId: string, signal: AbortSignal) => Promise<void>;
  // The newest event id; a job reads the watermark before it reads the file.
  readonly eventWatermark: (signal: AbortSignal) => Promise<string>;
  // Marks open events for the path up to the watermark as done: an event recorded after the
  // job's read stays pending and runs again (idempotent), so no later edit is lost.
  readonly completeDocument: (
    sourceId: string,
    path: string,
    upToEventId: string,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly completeResync: (eventId: string, signal: AbortSignal) => Promise<void>;
  readonly recordScan: (sourceId: string, scan: ScanRecord, signal: AbortSignal) => Promise<void>;
  readonly embeddingTargets: (signal: AbortSignal) => Promise<VersionTarget[]>;
  // Selected chunks of live current revisions without a hash-matching vector (optionally one document).
  readonly missingVectors: (
    versionId: string,
    limit: number,
    documentId: string | null,
    signal: AbortSignal,
  ) => Promise<MissingVector[]>;
  readonly storeVectors: (
    target: VersionTarget,
    rows: readonly {
      readonly chunkId: string;
      readonly contentHash: string;
      readonly vector: readonly number[];
    }[],
    signal: AbortSignal,
  ) => Promise<void>;
};

// Verified readers for enabled sources only; undefined for an unknown or disabled source.
export type SourceReaders = (sourceName: string) => Promise<SourceReader | undefined>;

export type DocumentEmbedding = {
  readonly vectors: readonly (readonly number[])[];
  readonly profileId: string;
  readonly dimensions: number;
};

export type DocumentEmbedder = (
  texts: readonly string[],
  profileId: string,
  signal: AbortSignal,
) => Promise<
  | { readonly ok: true; readonly value: DocumentEmbedding }
  | { readonly ok: false; readonly retryable: boolean; readonly message: string }
>;
