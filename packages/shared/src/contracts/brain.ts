// Wire contracts for the protected brain routes (#124, docs/specs/brain-api-contracts.md).
// Browser-safe: zod only. The api validates requests and serializes responses with these, and
// the CLI and MCP server parse responses with the same schemas. Domain validation of citation
// paths and the display form lives in @aetherion/brain; these bound sizes and shapes on the wire.
import { z } from 'zod';

export const BRAIN_SEARCH_DEFAULT_LIMIT = 8;
export const BRAIN_SEARCH_MAX_LIMIT = 50;
export const BRAIN_QUERY_MAX_CHARS = 1_000;
export const BRAIN_SNIPPET_MAX_CHARS = 1_200;
export const BRAIN_EXCERPT_DEFAULT_CHARS = 2_000;
export const BRAIN_EXCERPT_MAX_CHARS = 8_000;
export const BRAIN_HEADING_MAX_DEPTH = 6; // Markdown h1-h6
export const BRAIN_LINE_MAX = 999_999_999;
// Worst-case length of the citation display form produced by the @aetherion/brain codec
// (escaped path and headings, separators, occurrence and line range). A test in the brain
// package formats that worst case and checks it passes this contract.
export const BRAIN_CITATION_DISPLAY_MAX_CHARS =
  96 +
  1 +
  3 * 2048 +
  1 +
  BRAIN_HEADING_MAX_DEPTH * 9 * 500 +
  (BRAIN_HEADING_MAX_DEPTH - 1) * 3 +
  1 +
  5 +
  2 +
  2 * 9 +
  1;

const identifier = z.string().regex(/^[A-Za-z0-9_.-]{1,96}$/);
const contentHash = z.string().regex(/^[a-f0-9]{64}$/);
const tag = z.string().regex(/^[\p{L}\p{N}_/-]{1,64}$/u);
const relativePath = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (path) =>
      !path.startsWith('/') &&
      !path.includes('\\') &&
      // eslint-disable-next-line no-control-regex
      !/[\u0000-\u001f\u007f]/.test(path) &&
      path.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
    'must be a safe relative path',
  );
const lineNumber = z.int().min(1).max(BRAIN_LINE_MAX);
const isoTimestamp = z.iso.datetime({ offset: false });

// Querystrings carry one value as a string and repeated keys as an array.
const listParam = <T extends z.ZodType>(item: T, max: number) =>
  z.preprocess(
    (value: unknown): unknown[] =>
      value === undefined ? [] : Array.isArray(value) ? (value as unknown[]) : [value],
    z.array(item).max(max),
  );

export const brainSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(BRAIN_QUERY_MAX_CHARS),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(BRAIN_SEARCH_MAX_LIMIT)
    .default(BRAIN_SEARCH_DEFAULT_LIMIT),
  source: listParam(identifier, 8),
  tag: listParam(tag, 16),
  tagMode: z.enum(['any', 'all']).default('any'),
  // Component-aware: `Projects` matches `Projects/a.md`, never `Projects-old/a.md`.
  pathPrefix: relativePath.optional(),
  // Lexical-only search is degraded and must be asked for; it is never a silent fallback.
  mode: z.enum(['hybrid', 'lexical']).default('hybrid'),
});

export const brainCitationSchema = z
  .strictObject({
    display: z.string().min(1).max(BRAIN_CITATION_DISPLAY_MAX_CHARS),
    sourceId: identifier,
    documentId: identifier,
    revision: z.int().min(0),
    contentHash,
    chunkId: identifier,
    versionId: identifier,
    path: relativePath,
    headingPath: z.array(z.string().min(1).max(500)).max(BRAIN_HEADING_MAX_DEPTH),
    headingOccurrence: z.int().min(1).max(10_000),
    lineStart: lineNumber,
    lineEnd: lineNumber,
  })
  .refine((citation) => citation.lineStart <= citation.lineEnd, 'line range is reversed');

export const brainSearchResultSchema = z
  .strictObject({
    chunkId: identifier,
    documentPath: relativePath,
    title: z.string().max(500).nullable(),
    headingPath: z.array(z.string().min(1).max(500)).max(BRAIN_HEADING_MAX_DEPTH),
    lineStart: lineNumber,
    lineEnd: lineNumber,
    // Untrusted note text: consumers wrap it in data delimiters and never act on it.
    snippet: z.string().max(BRAIN_SNIPPET_MAX_CHARS),
    fusedScore: z.number().finite().min(0),
    vectorRank: z.int().min(1).nullable(),
    lexicalRank: z.int().min(1).nullable(),
    cosineSimilarity: z.number().finite().min(-1).max(1).nullable(),
    lexicalScore: z.number().finite().min(0).nullable(),
    citation: brainCitationSchema,
  })
  .refine((result) => result.lineStart <= result.lineEnd, 'line range is reversed');

const searchBase = {
  // `incomplete`: not every eligible chunk is embedded/indexed in the pinned version.
  corpus: z.enum(['complete', 'incomplete']),
  mode: z.enum(['hybrid', 'lexical_only']),
  tookMs: z.number().finite().min(0),
};

export const brainSearchResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ok'),
    versionId: identifier,
    results: z.array(brainSearchResultSchema).min(1).max(BRAIN_SEARCH_MAX_LIMIT),
    ...searchBase,
  }),
  // A legitimate empty answer: candidates existed but none passed the evidence gates.
  z.strictObject({
    status: z.literal('no_match'),
    versionId: identifier,
    results: z.array(brainSearchResultSchema).max(0),
    ...searchBase,
  }),
  // No active version yet. Embedding failure is a 503 error envelope, not a status here.
  z.strictObject({
    status: z.literal('not_indexed'),
    versionId: z.null(),
    results: z.array(brainSearchResultSchema).max(0),
    ...searchBase,
  }),
]);

export const brainNoteQuerySchema = z.strictObject({
  sourceId: identifier,
  documentId: identifier,
  chunkId: identifier,
  versionId: identifier,
  revision: z.coerce.number().int().min(0),
  contentHash,
  path: relativePath,
  maxChars: z.coerce
    .number()
    .int()
    .min(1)
    .max(BRAIN_EXCERPT_MAX_CHARS)
    .default(BRAIN_EXCERPT_DEFAULT_CHARS),
});

// Unknown or out-of-scope citations are a 404 error envelope (one answer for both, so scope is
// not probeable); a known chunk whose document changed is `stale` and returns no text.
export const brainNoteResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ok'),
    citation: brainCitationSchema,
    excerpt: z.string().max(BRAIN_EXCERPT_MAX_CHARS),
    truncated: z.boolean(),
  }),
  z.strictObject({
    status: z.literal('stale'),
    reason: z.enum(['deleted', 'revision', 'content', 'path']),
  }),
]);

export const brainStatsResponseSchema = z.strictObject({
  activeVersion: z
    .strictObject({
      id: identifier,
      embedRole: z.literal('embed'),
      dimensions: z.int().min(1).max(16_000),
      chunkerVersion: z.string().min(1).max(64),
      promotedAt: isoTimestamp,
    })
    .nullable(),
  documents: z.int().min(0),
  chunks: z.int().min(0),
  embeddedChunks: z.int().min(0),
  corpus: z.enum(['complete', 'incomplete', 'empty']),
  sources: z
    .array(
      z.strictObject({
        id: identifier,
        documents: z.int().min(0),
        lastIngestAt: isoTimestamp.nullable(),
        lastScan: z.enum(['complete', 'incomplete', 'never']),
      }),
    )
    .max(64),
});

export type BrainSearchQuery = z.infer<typeof brainSearchQuerySchema>;
export type BrainCitation = z.infer<typeof brainCitationSchema>;
export type BrainSearchResult = z.infer<typeof brainSearchResultSchema>;
export type BrainSearchResponse = z.infer<typeof brainSearchResponseSchema>;
export type BrainNoteQuery = z.infer<typeof brainNoteQuerySchema>;
export type BrainNoteResponse = z.infer<typeof brainNoteResponseSchema>;
export type BrainStatsResponse = z.infer<typeof brainStatsResponseSchema>;
