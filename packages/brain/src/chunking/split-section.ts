import { utf8Bytes } from './tokens.ts';
import type { TokenEstimator } from './types.ts';

export type SplitLimits = {
  readonly target: number;
  readonly overlap: number;
  readonly availableContext: number;
  readonly estimate: TokenEstimator;
};

export const tokenCount = (text: string, estimate: TokenEstimator): number => {
  const count = estimate(text);
  if (!Number.isFinite(count) || count < 0 || count > Number.MAX_SAFE_INTEGER)
    throw new RangeError('token estimator must return a finite nonnegative count');
  return Math.ceil(count);
};

const scalarEnds = (text: string, start: number, end: number): number[] => {
  const ends: number[] = [];
  for (let cursor = start; cursor < end;) {
    const size =
      (text.codePointAt(cursor) ?? 0) > 0xffff ||
      (text[cursor] === '\r' && text[cursor + 1] === '\n')
        ? 2
        : 1;
    if (cursor + size > end) break;
    cursor += size;
    ends.push(cursor);
  }
  return ends;
};

// Search only as far as the context byte budget permits (UTF-8 bytes >= UTF-16 units).
const fittingEnd = (body: string, start: number, end: number, limits: SplitLimits): number => {
  const ends = scalarEnds(body, start, Math.min(end, start + limits.availableContext));
  let low = 0;
  let high = ends.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = body.slice(start, ends[middle - 1]);
    if (
      utf8Bytes(candidate) <= limits.availableContext &&
      tokenCount(candidate, limits.estimate) <= limits.target
    )
      low = middle;
    else high = middle - 1;
  }
  return low ? (ends[low - 1] ?? start) : start;
};

const preferredEnd = (body: string, start: number, end: number): number => {
  const part = body.slice(start, end);
  // Whole paragraphs first, then whole lines; never split a CRLF pair.
  const paragraph = [...part.matchAll(/(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/g)].at(-1);
  if (paragraph) return start + paragraph.index + paragraph[0].length;
  const newline = [...part.matchAll(/\r\n|\r|\n/g)].at(-1);
  if (newline && newline.index + newline[0].length > 0)
    return start + newline.index + newline[0].length;
  return end;
};

const overlapStart = (body: string, start: number, end: number, limits: SplitLimits): number => {
  if (limits.overlap === 0) return end;
  // Context-bound tail keeps very long sections from producing quadratic scans.
  // Even an optimistic estimator must not make overlap consume nearly every new chunk.
  let tail = Math.max(start + Math.ceil((end - start) / 2), end - limits.availableContext);
  const unit = body.charCodeAt(tail);
  if ((unit >= 0xdc00 && unit <= 0xdfff) || (body[tail] === '\n' && body[tail - 1] === '\r'))
    tail++;
  const ends = [tail, ...scalarEnds(body, tail, end)].filter((offset) => offset > start);
  let low = 0;
  let high = ends.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (tokenCount(body.slice(ends[middle], end), limits.estimate) <= limits.overlap) high = middle;
    else low = middle + 1;
  }
  return ends[low] ?? end;
};

export function* splitSection(
  body: string,
  start: number,
  end: number,
  limits: SplitLimits,
): Generator<{ start: number; end: number }> {
  let cursor = start;
  let covered = start;
  while (covered < end) {
    let next = fittingEnd(body, cursor, end, limits);
    if (next <= covered && cursor < covered) {
      cursor = covered; // Drop overlap if otherwise there is no room for new source content.
      next = fittingEnd(body, cursor, end, limits);
    }
    if (next <= cursor) throw new RangeError('one Unicode scalar exceeds the chunk/context budget');
    if (next < end) {
      const preferred = preferredEnd(body, cursor, next);
      if (preferred > covered) next = preferred;
    }
    yield { start: cursor, end: next };
    covered = next;
    cursor = overlapStart(body, cursor, next, limits);
  }
}
