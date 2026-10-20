// `@aetherion/shared/contracts`: browser-safe wire contracts (zod schemas and inferred DTOs).
// Server-only modules (config, logging) stay on the package root entry.
export {
  BRAIN_EXCERPT_DEFAULT_CHARS,
  BRAIN_EXCERPT_MAX_CHARS,
  BRAIN_QUERY_MAX_CHARS,
  BRAIN_SEARCH_DEFAULT_LIMIT,
  BRAIN_SEARCH_MAX_LIMIT,
  BRAIN_SNIPPET_MAX_CHARS,
  brainCitationSchema,
  brainNoteQuerySchema,
  brainNoteResponseSchema,
  brainSearchQuerySchema,
  brainSearchResponseSchema,
  brainSearchResultSchema,
  brainStatsResponseSchema,
  type BrainCitation,
  type BrainNoteQuery,
  type BrainNoteResponse,
  type BrainSearchQuery,
  type BrainSearchResponse,
  type BrainSearchResult,
  type BrainStatsResponse,
} from './brain.ts';
