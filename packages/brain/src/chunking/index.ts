// Internal module entry; package-root export is wired by the integration owner.
export { chunkMarkdown, CHUNKER_VERSION } from './chunk-markdown.ts';
export { calibrateTokenEstimator, estimateTokens, utf8Bytes } from './tokens.ts';
export type { TokenSample } from './tokens.ts';
export type { ChunkOptions, ChunkSource, MarkdownChunk, TokenEstimator } from './types.ts';
