export {
  createDatabaseClient,
  type Database,
  type DatabaseClient,
  type DatabaseOptions,
} from './client.ts';
export {
  brainTables,
  chunkEmbeddings1024,
  chunkEmbeddings768,
  chunks,
  documents,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_VERSION_STATUSES,
  embeddingVersions,
  LINK_KINDS,
  links,
  searchConfig,
  SOURCE_KINDS,
  sources,
} from './schema/brain.ts';
