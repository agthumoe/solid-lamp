import { parseDocument } from 'yaml';

import type { JsonValue, ParseWarning } from './types.ts';

const encoder = new TextEncoder();
const MAX_YAML_BYTES = 16 * 1024;

const jsonMetadata = (value: unknown): value is Record<string, JsonValue> => {
  let nodes = 0;
  const ancestors = new Set<object>();
  const visit = (entry: unknown, depth: number): boolean => {
    if (++nodes > 4096 || depth > 12) return false;
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return true;
    if (typeof entry === 'number') return Number.isFinite(entry);
    if (typeof entry !== 'object' || ancestors.has(entry)) return false;
    if (!Array.isArray(entry) && Object.getPrototypeOf(entry) !== Object.prototype) return false;
    ancestors.add(entry);
    const valid = Array.isArray(entry)
      ? entry.every((item: unknown) => visit(item, depth + 1))
      : Object.entries(entry).every(
          ([key, item]) =>
            !['__proto__', 'prototype', 'constructor'].includes(key) && visit(item, depth + 1),
        );
    ancestors.delete(entry);
    return valid;
  };
  return typeof value === 'object' && value !== null && !Array.isArray(value) && visit(value, 0);
};

const decode = (yaml: string): Record<string, JsonValue> => {
  const document = parseDocument(yaml, { schema: 'core', uniqueKeys: true, prettyErrors: false });
  if (document.errors.length || document.warnings.length) throw new Error('invalid metadata');
  const value: unknown = document.toJS({ maxAliasCount: 20 });
  if (value === null) return {};
  if (!jsonMetadata(value) || encoder.encode(JSON.stringify(value)).length > 64 * 1024)
    throw new Error('invalid metadata');
  return value;
};

export const splitFrontmatter = (
  text: string,
): {
  readonly body: string;
  readonly bodyStartLine: number;
  readonly bodyStartOffset: number;
  readonly metadata: Readonly<Record<string, JsonValue>>;
  readonly warnings: readonly ParseWarning[];
} => {
  const bom = text.startsWith('\uFEFF') ? 1 : 0;
  const opening = text.slice(bom).match(/^---[ \t]*(?:\r\n|\r|\n)/);
  const unchanged = { body: text, bodyStartLine: 1, bodyStartOffset: 0, metadata: {} };
  if (!opening) return { ...unchanged, warnings: [] };
  const start = bom + opening[0].length;
  let line = 2;
  for (const match of text.slice(start).matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
    if (!match[0]) break;
    if (/^---[ \t]*$/.test(match[1] ?? '')) {
      const bodyStartOffset = start + match.index + match[0].length;
      const yaml = text.slice(start, start + match.index);
      const split = {
        body: text.slice(bodyStartOffset),
        bodyStartOffset,
        bodyStartLine: line + (match[2] ? 1 : 0),
      };
      if (encoder.encode(yaml).length > MAX_YAML_BYTES)
        return { ...split, metadata: {}, warnings: ['FRONTMATTER_TOO_LARGE'] };
      try {
        return { ...split, metadata: decode(yaml), warnings: [] };
      } catch {
        return { ...split, metadata: {}, warnings: ['INVALID_FRONTMATTER'] };
      }
    }
    line++;
  }
  return { ...unchanged, warnings: ['UNTERMINATED_FRONTMATTER'] };
};
