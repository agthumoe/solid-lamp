// Typed mirror of supabase/migrations/20261018120000_brain_core.sql. The SQL file is the only
// schema history; this file gives adapters typed, parameterized queries. Constraints, the
// generated tsvector expression, partial/HNSW indexes and RLS live in SQL and are checked by
// the parity integration test (test/integration/brain-schema.int.test.ts).
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
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
  chunks,
  links,
  embeddingVersions,
  chunkEmbeddings1024,
  chunkEmbeddings768,
  searchConfig,
} as const;
