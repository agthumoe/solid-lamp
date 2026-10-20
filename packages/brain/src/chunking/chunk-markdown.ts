import { lineAt, markdownSections, sourceLines } from './markdown-sections.ts';
import { splitSection, tokenCount } from './split-section.ts';
import { estimateTokens } from './tokens.ts';
import type { ChunkOptions, ChunkSource, MarkdownChunk } from './types.ts';

export const CHUNKER_VERSION = 'heading-paragraph-v1';

const integer = (value: number, name: string, minimum: number): number => {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`invalid ${name}`);
  return value;
};

/** Pure transformation: it cannot read a path, change a source, select a model or run a tool. */
export const chunkMarkdown = (source: ChunkSource, options: ChunkOptions = {}): MarkdownChunk[] => {
  const firstLine = integer(source.bodyStartLine ?? 1, 'bodyStartLine', 1);
  const target = integer(options.targetTokens ?? 650, 'targetTokens', 1);
  const overlap = integer(options.overlapTokens ?? 80, 'overlapTokens', 0);
  const context = integer(options.contextTokens ?? 8192, 'contextTokens', 1);
  const reserve = integer(options.reserveTokens ?? 256, 'reserveTokens', 0);
  if (overlap >= target || reserve >= context || target > context - reserve)
    throw new RangeError('overlap must be below target, and target must fit the reserved context');
  const estimate = options.estimateTokens ?? estimateTokens;
  const limits = { target, overlap, availableContext: context - reserve, estimate };
  const lines = sourceLines(source.body);
  const chunks: MarkdownChunk[] = [];
  for (const section of markdownSections(source.body, lines, firstLine)) {
    if (!source.body.slice(section.start, section.end).trim()) continue;
    for (const span of splitSection(source.body, section.start, section.end, limits)) {
      const content = source.body.slice(span.start, span.end);
      chunks.push({
        ordinal: chunks.length,
        content,
        startOffset: span.start,
        endOffset: span.end,
        lineStart: firstLine + lineAt(lines, span.start),
        lineEnd: firstLine + lineAt(lines, span.end - 1),
        headingPath: [...section.headingPath],
        headingLine: section.headingLine,
        estimatedTokens: tokenCount(content, estimate),
        chunkerVersion: CHUNKER_VERSION,
      });
    }
  }
  return chunks;
};
