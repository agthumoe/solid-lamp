import { z } from 'zod';

import { extractMarkdown } from './extract-markdown.ts';
import { splitFrontmatter } from './frontmatter.ts';
import { fileStem, validNotePath } from './paths.ts';
import type { NoteParseResult, ParseWarning } from './types.ts';

const inputSchema = z.strictObject({
  sourceId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  path: z.string().refine(validNotePath),
  text: z.string().max(2 * 1024 * 1024),
});
const listSchema = z.union([z.string().max(4000), z.array(z.string().max(500)).max(128)]);
const titleSchema = z.string().trim().min(1).max(500);
const encoder = new TextEncoder();

const metadataList = (
  value: unknown,
  kind: 'tags' | 'aliases',
  warnings: ParseWarning[],
): string[] => {
  if (value === undefined) return [];
  const parsed = listSchema.safeParse(value);
  if (!parsed.success) {
    warnings.push('INVALID_METADATA_FIELD');
    return [];
  }
  const values =
    typeof parsed.data === 'string'
      ? kind === 'tags'
        ? parsed.data.split(/[\s,]+/)
        : [parsed.data]
      : parsed.data;
  return [
    ...new Set(
      values
        .map((item) => (kind === 'tags' ? item.trim().replace(/^#/, '') : item.trim()))
        .filter(Boolean),
    ),
  ];
};

export const parseNote = (input: unknown): NoteParseResult => {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: 'INVALID_NOTE_INPUT' } };
  const { sourceId, path, text } = parsed.data;
  if (encoder.encode(text).length > 2 * 1024 * 1024)
    return { ok: false, error: { code: 'NOTE_TOO_LARGE' } };
  const split = splitFrontmatter(text);
  const warnings = [...split.warnings];
  const title = titleSchema.safeParse(split.metadata.title);
  if (split.metadata.title !== undefined && !title.success) warnings.push('INVALID_METADATA_FIELD');
  const markdown = extractMarkdown(split.body, split.bodyStartLine, split.bodyStartOffset);
  warnings.push(...markdown.warnings);
  const aliases = metadataList(split.metadata.aliases, 'aliases', warnings);
  const tags = [
    ...new Set([...metadataList(split.metadata.tags, 'tags', warnings), ...markdown.tags]),
  ];
  return {
    ok: true,
    value: {
      sourceId,
      path,
      title: title.success ? title.data : fileStem(path),
      aliases,
      tags,
      frontmatter: split.metadata,
      body: split.body,
      bodyStartLine: split.bodyStartLine,
      bodyStartOffset: split.bodyStartOffset,
      links: markdown.links,
      warnings: [...new Set(warnings)],
    },
  };
};
