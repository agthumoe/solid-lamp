import type { MarkdownSection, SourceLine } from './types.ts';

// Keep offsets into the original text: citation ranges must not drift after CRLF normalization.
export const sourceLines = (body: string): SourceLine[] => {
  const lines: SourceLine[] = [];
  const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  for (const match of body.matchAll(pattern)) {
    if (!match[0]) break;
    lines.push({ start: match.index, end: match.index + match[0].length, text: match[1] ?? '' });
  }
  return lines;
};

// Offset of a character, not the exclusive end of a chunk.
export const lineAt = (lines: readonly SourceLine[], offset: number): number => {
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((lines[middle]?.start ?? Infinity) <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
};

type Heading = {
  readonly offset: number;
  readonly line: number;
  readonly level: number;
  readonly title: string;
};

const headings = (lines: readonly SourceLine[]): Heading[] => {
  const found: Heading[] = [];
  let fence: { marker: string; length: number } | undefined;
  let previousIsProse = false;
  for (const [index, line] of lines.entries()) {
    const marker = line.text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        marker?.[1]?.[0] === fence.marker &&
        marker[1].length >= fence.length &&
        !marker[2]?.trim()
      )
        fence = undefined;
      previousIsProse = false;
      continue;
    }
    // Backtick fence info strings cannot themselves contain backticks.
    if (marker?.[1] && !(marker[1][0] === '`' && marker[2]?.includes('`'))) {
      fence = { marker: marker[1][0] ?? '`', length: marker[1].length };
      previousIsProse = false;
      continue;
    }
    const atx = line.text.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/);
    const setext: RegExpMatchArray | null = previousIsProse
      ? line.text.match(/^ {0,3}(=+|-+)[ \t]*$/)
      : null;
    if (atx?.[1]) {
      found.push({
        offset: line.start,
        line: index,
        level: atx[1].length,
        title: (atx[2] ?? '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim(),
      });
    } else if (setext?.[1]) {
      const previous = lines[index - 1];
      if (previous)
        found.push({
          offset: previous.start,
          line: index - 1,
          level: setext[1][0] === '=' ? 1 : 2,
          title: previous.text.trim(),
        });
    }
    previousIsProse =
      !atx &&
      !setext &&
      Boolean(line.text.trim()) &&
      !/^(?: {4}|\t| {0,3}(?:>|[-+*] |\d+[.)] ))/.test(line.text);
  }
  return found;
};

export const markdownSections = (
  body: string,
  lines: readonly SourceLine[],
  firstLine: number,
): MarkdownSection[] => {
  const sections: MarkdownSection[] = [];
  const stack: { level: number; title: string }[] = [];
  let start = 0;
  let headingLine: number | undefined;
  let headingPath: string[] = [];
  for (const heading of headings(lines)) {
    if (heading.offset > start)
      sections.push({ start, end: heading.offset, headingPath, headingLine });
    while (stack.length && (stack.at(-1)?.level ?? 0) >= heading.level) stack.pop();
    stack.push({ level: heading.level, title: heading.title });
    start = heading.offset;
    headingLine = firstLine + heading.line;
    headingPath = stack.map((entry) => entry.title);
  }
  if (start < body.length) sections.push({ start, end: body.length, headingPath, headingLine });
  return sections;
};
