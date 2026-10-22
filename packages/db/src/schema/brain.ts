// Typed mirror of supabase/migrations (20261018120000_brain_core.sql,
// 20261021120000_brain_revisions.sql and 20261022120000_brain_search.sql). The SQL files are the only schema history; this file gives adapters typed, parameterized queries. Constraints, the
// generated tsvector expression, partial/HNSW indexes and RLS live in SQL and are checked by
// the parity integration test (test/integration/brain-schema.int.test.ts).
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  vector,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const ref = (name: string) => bigint(name, { mode: 'number' });

export const SOURCE_KINDS = ['obsidian', 'repo', 'email', 'finance_csv', 'manual'] as const;
export const LINK_KINDS = ['wikilink', 'tag', 'mention', 'import'] as const;
export const EMBEDDING_DIMENSIONS = [768, 1024] as const;
export const REVISION_KINDS = ['content', 'tombstone'] as const;
export const INGEST_EVENT_KINDS = ['changed', 'deleted', 'resync'] as const;
export const INGEST_EVENT_STATUSES = ['pending', 'leased', 'done', 'failed', 'superseded'] as const;
export const EMBEDDING_BUILD_STATUSES = ['running', 'paused', 'completed', 'failed'] as const;
export const EMBEDDING_VERSION_STATUSES = [
  'building',
  'ready',
  'active',
  'retired',
  'failed',
] as const;

export const sources = pgTable('sources', {
  id: id(),
  kind: text('kind', { enum: SOURCE_KINDS }).notNull(),
  name: text('name').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const documents = pgTable('documents', {
  id: id(),
  sourceId: ref('source_id')
    .notNull()
    .references(() => sources.id, { onDelete: 'cascade' }),
  uri: text('uri').notNull(),
  title: text('title').notNull().default(''),
  frontmatter: jsonb('frontmatter').$type<Record<string, unknown>>().notNull().default({}),
  tags: text('tags')
    .array()
    .notNull()
    .default(sql`'{}'`),
  contentHash: text('content_hash').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
  // Composite FK (current_revision_id, id) -> document_revisions (id, document_id), deferred.
  currentRevisionId: ref('current_revision_id'),
});

export const documentRevisions = pgTable('document_revisions', {
  id: id(),
  documentId: ref('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  kind: text('kind', { enum: REVISION_KINDS }).notNull(),
  uri: text('uri').notNull(),
  title: text('title').notNull().default(''),
  frontmatter: jsonb('frontmatter').$type<Record<string, unknown>>().notNull().default({}),
  tags: text('tags')
    .array()
    .notNull()
    .default(sql`'{}'`),
  contentHash: text('content_hash'),
  createdAt: createdAt(),
});

// FKs (document_revision_id, document_id) -> document_revisions are composite (SQL only).
export const chunkSets = pgTable('chunk_sets', {
  id: id(),
  documentRevisionId: ref('document_revision_id').notNull(),
  documentId: ref('document_id').notNull(),
  chunkerVersion: text('chunker_version').notNull(),
  createdAt: createdAt(),
});

export const chunks = pgTable('chunks', {
  id: id(),
  documentId: ref('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  ordinal: integer('ordinal').notNull(),
  headingPath: text('heading_path')
    .array()
    .notNull()
    .default(sql`'{}'`),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  tokenCount: integer('token_count').notNull(),
  chunkerVersion: text('chunker_version').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('english', content)`),
  createdAt: createdAt(),
  // Composite FKs to chunk_sets (document, chunker) are SQL only.
  chunkSetId: ref('chunk_set_id').notNull(),
  lineStart: integer('line_start'),
  lineEnd: integer('line_end'),
});

export const links = pgTable('links', {
  id: id(),
  fromDocumentId: ref('from_document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  toDocumentId: ref('to_document_id').references(() => documents.id, { onDelete: 'set null' }),
  toTitle: text('to_title').notNull(),
  kind: text('kind', { enum: LINK_KINDS }).notNull(),
  createdAt: createdAt(),
});

export const embeddingProfiles = pgTable('embedding_profiles', {
  id: text('id').primaryKey(),
  model: text('model').notNull(),
  modelDigest: text('model_digest').notNull(),
  dimensions: integer('dimensions').notNull(),
  queryPrefix: text('query_prefix').notNull().default(''),
  documentPrefix: text('document_prefix').notNull().default(''),
  numCtx: integer('num_ctx'),
  createdAt: createdAt(),
});

export const embeddingVersions = pgTable('embedding_versions', {
  id: id(),
  model: text('model').notNull(),
  modelDigest: text('model_digest').notNull(),
  dimensions: integer('dimensions').notNull(),
  queryPrefix: text('query_prefix').notNull().default(''),
  documentPrefix: text('document_prefix').notNull().default(''),
  chunkerVersion: text('chunker_version').notNull(),
  status: text('status', { enum: EMBEDDING_VERSION_STATUSES }).notNull().default('building'),
  promotedAt: timestamp('promoted_at', { withTimezone: true }),
  createdAt: createdAt(),
  // Composite FK (profile_id, dimensions, model_digest) -> embedding_profiles is SQL only.
  profileId: text('profile_id').notNull(),
});

export const embeddingVersionGates = pgTable('embedding_version_gates', {
  embeddingVersionId: ref('embedding_version_id')
    .primaryKey()
    .references(() => embeddingVersions.id, { onDelete: 'cascade' }),
  gateId: text('gate_id').notNull(),
  minCosine: doublePrecision('min_cosine'),
  minLexical: doublePrecision('min_lexical'),
  calibrationQuestions: integer('calibration_questions'),
  calibrationSha256: text('calibration_sha256'),
  calibrationTopK: integer('calibration_top_k'),
  createdAt: createdAt(),
});

export const embeddingVersionSelections = pgTable(
  'embedding_version_selections',
  {
    embeddingVersionId: ref('embedding_version_id').notNull(),
    documentId: ref('document_id').notNull(),
    chunkSetId: ref('chunk_set_id').notNull(),
    chunkerVersion: text('chunker_version').notNull(),
    selectedAt: timestamp('selected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.embeddingVersionId, table.documentId] })],
);

export const sourceSyncState = pgTable('source_sync_state', {
  sourceId: ref('source_id')
    .primaryKey()
    .references(() => sources.id, { onDelete: 'cascade' }),
  lastScanStartedAt: timestamp('last_scan_started_at', { withTimezone: true }),
  lastScanCompletedAt: timestamp('last_scan_completed_at', { withTimezone: true }),
  lastScanComplete: boolean('last_scan_complete').notNull().default(false),
  filesSeen: integer('files_seen').notNull().default(0),
  filesIndexed: integer('files_indexed').notNull().default(0),
  filesSkipped: integer('files_skipped').notNull().default(0),
  lastErrorCode: text('last_error_code'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ingestEvents = pgTable('ingest_events', {
  id: id(),
  sourceId: ref('source_id')
    .notNull()
    .references(() => sources.id, { onDelete: 'cascade' }),
  documentId: ref('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: INGEST_EVENT_KINDS }).notNull(),
  pathHash: text('path_hash'),
  baseRevisionId: ref('base_revision_id').references(() => documentRevisions.id, {
    onDelete: 'set null',
  }),
  status: text('status', { enum: INGEST_EVENT_STATUSES }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  lastErrorCode: text('last_error_code'),
  createdAt: createdAt(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

export const embeddingBuilds = pgTable('embedding_builds', {
  id: id(),
  embeddingVersionId: ref('embedding_version_id')
    .notNull()
    .references(() => embeddingVersions.id, { onDelete: 'cascade' }),
  status: text('status', { enum: EMBEDDING_BUILD_STATUSES }).notNull().default('running'),
  totalChunks: integer('total_chunks').notNull().default(0),
  embeddedChunks: integer('embedded_chunks').notNull().default(0),
  cursorChunkId: ref('cursor_chunk_id'),
  watermarkEventId: ref('watermark_event_id'),
  lastErrorCode: text('last_error_code'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const embeddingVersionLeases = pgTable('embedding_version_leases', {
  id: id(),
  embeddingVersionId: ref('embedding_version_id')
    .notNull()
    .references(() => embeddingVersions.id, { onDelete: 'cascade' }),
  holder: text('holder').notNull(),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

const embeddingTable = <D extends number>(name: string, dimensions: D) =>
  pgTable(
    name,
    {
      embeddingVersionId: ref('embedding_version_id').notNull(),
      chunkId: ref('chunk_id')
        .notNull()
        .references(() => chunks.id, { onDelete: 'cascade' }),
      dimensions: integer('dimensions').notNull().default(dimensions),
      contentHash: text('content_hash').notNull(),
      embedding: vector('embedding', { dimensions }).notNull(),
      createdAt: createdAt(),
    },
    (table) => [primaryKey({ columns: [table.embeddingVersionId, table.chunkId] })],
  );

export const chunkEmbeddings1024 = embeddingTable('chunk_embeddings_1024', 1024);
export const chunkEmbeddings768 = embeddingTable('chunk_embeddings_768', 768);

export const searchConfig = pgTable('search_config', {
  id: boolean('id').primaryKey().default(true),
  activeEmbeddingVersionId: ref('active_embedding_version_id'),
  activeStatus: text('active_status', { enum: ['active'] }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const brainTables = {
  sources,
  documents,
  documentRevisions,
  chunkSets,
  chunks,
  links,
  embeddingProfiles,
  embeddingVersions,
  embeddingVersionSelections,
  embeddingVersionGates,
  chunkEmbeddings1024,
  chunkEmbeddings768,
  searchConfig,
  sourceSyncState,
  ingestEvents,
  embeddingBuilds,
  embeddingVersionLeases,
} as const;
