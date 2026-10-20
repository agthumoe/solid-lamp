// Pure chunker contract. The parser supplies a body without frontmatter and its source offset.
export type ChunkSource = {
  readonly body: string;
  readonly bodyStartLine?: number;
};

export type TokenEstimator = (text: string) => number;

export type ChunkOptions = {
  readonly targetTokens?: number;
  readonly overlapTokens?: number;
  readonly contextTokens?: number;
  readonly reserveTokens?: number;
  // Must be deterministic and monotonic under substring extension; actual tokenization happens in inference.
  readonly estimateTokens?: TokenEstimator;
};

export type MarkdownChunk = {
  readonly ordinal: number;
  readonly content: string;
  readonly startOffset: number;
  readonly endOffset: number; // exclusive UTF-16 body offset
  readonly lineStart: number;
  readonly lineEnd: number; // inclusive source line
  readonly headingPath: readonly string[];
  readonly headingLine: number | undefined;
  readonly estimatedTokens: number;
  readonly chunkerVersion: string;
};

export type SourceLine = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

export type MarkdownSection = {
  readonly start: number;
  readonly end: number;
  readonly headingPath: readonly string[];
  readonly headingLine: number | undefined;
};
