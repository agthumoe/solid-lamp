import { isEscaped, maskCode } from './mask-code.ts';
import type { ParsedLink, ParseWarning } from './types.ts';

const linesBefore = (ends: readonly number[], offset: number): number => {
  let low = 0;
  let high = ends.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((ends[middle] ?? Infinity) <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
};

export const extractMarkdown = (
  body: string,
  bodyStartLine: number,
  bodyStartOffset: number,
): {
  readonly links: readonly ParsedLink[];
  readonly tags: readonly string[];
  readonly warnings: readonly ParseWarning[];
} => {
  const masked = maskCode(body);
  const links: ParsedLink[] = [];
  const warnings: ParseWarning[] = [];
  const occupied: { start: number; end: number }[] = [];
  const newlines = [...body.matchAll(/\r\n|\r|\n/g)].map((match) => match.index + match[0].length);
  for (const match of masked.matchAll(/(!?)\[\[([^[\]\r\n]+)\]\]/g)) {
    if (isEscaped(body, match.index)) continue;
    if (links.length >= 2048) {
      warnings.push('MARKDOWN_LIMIT_EXCEEDED');
      break;
    }
    const inside = body.slice(match.index + (match[1] ? 3 : 2), match.index + match[0].length - 2);
    const divider = inside.indexOf('|');
    const rawTarget = (divider < 0 ? inside : inside.slice(0, divider)).trim();
    if (!rawTarget) continue;
    // links.to_title is limited to 500 characters by the canonical SQL migration.
    if ([...rawTarget].length > 500) {
      warnings.push('MARKDOWN_LIMIT_EXCEEDED');
      continue;
    }
    const displayAlias = divider < 0 ? undefined : inside.slice(divider + 1).trim();
    const hash = rawTarget.indexOf('#');
    const caret = hash < 0 ? rawTarget.indexOf('^') : -1;
    const locator = hash < 0 ? undefined : rawTarget.slice(hash + 1);
    const targetPath = (
      hash >= 0 ? rawTarget.slice(0, hash) : caret >= 0 ? rawTarget.slice(0, caret) : rawTarget
    ).trim();
    const block = locator?.startsWith('^')
      ? locator.slice(1)
      : caret >= 0
        ? rawTarget.slice(caret + 1)
        : undefined;
    const start = match.index;
    const end = start + match[0].length;
    links.push({
      kind: match[1] ? 'import' : 'wikilink',
      rawTarget,
      targetPath,
      heading: block === undefined ? locator : undefined,
      block,
      displayAlias,
      startOffset: bodyStartOffset + start,
      endOffset: bodyStartOffset + end,
      line: bodyStartLine + linesBefore(newlines, start),
    });
    occupied.push({ start, end });
  }
  const tags = new Set<string>();
  let linkCursor = 0;
  for (const match of masked.matchAll(/(^|[\s(])#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu)) {
    const offset = match.index + (match[1]?.length ?? 0);
    const tag = match[2] ?? '';
    while ((occupied[linkCursor]?.end ?? Infinity) <= offset) linkCursor++;
    const span = occupied[linkCursor];
    if (tags.size >= 2048 && !tags.has(tag)) {
      warnings.push('MARKDOWN_LIMIT_EXCEEDED');
      break;
    }
    if (
      !isEscaped(body, offset) &&
      /[\p{L}_-]/u.test(tag) &&
      !(span && span.start <= offset && offset < span.end)
    )
      tags.add(tag);
  }
  return { links, tags: [...tags], warnings };
};
