// Human-readable citation form:  <source>:<path>[#<heading> > <heading>[~N]]@L<start>-<end>
// e.g. `vault:Projects/Plan.md#Goals > Q4~2@L12-18`. Delimiters, `%` and characters that can
// spoof display are percent-encoded (UTF-8, upper-case hex) so the form is unambiguous, and
// parsing accepts only the canonical encoding: format(parse(s)) === s for every accepted s.
import {
  isSafeRelativePath,
  isWellFormed,
  MAX_HEADING_DEPTH,
  MAX_DISPLAY_LENGTH,
  MAX_HEADING_LENGTH,
  MAX_LINE,
  MAX_OCCURRENCE,
  UNSAFE_DISPLAY,
} from './structured.ts';

export type DisplayCitation = {
  readonly sourceId: string;
  readonly path: string;
  readonly headingPath: readonly string[];
  readonly headingOccurrence: number;
  readonly lineStart: number;
  readonly lineEnd: number;
};

export type DisplayParseResult =
  | { readonly ok: true; readonly value: DisplayCitation }
  | { readonly ok: false; readonly reason: string };

const HEADING_SEPARATOR = ' > ';
const SOURCE = /^[A-Za-z0-9_.-]{1,96}$/;

const PATH_RESERVED = new Set(['%', '#', '@']);
const HEADING_RESERVED = new Set(['%', '#', '@', '>', '~']);

const encodeChar = (char: string) =>
  [...new TextEncoder().encode(char)]
    .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
    .join('');

const encode = (text: string, reserved: ReadonlySet<string>, edges: boolean) => {
  const chars = [...text];
  return chars
    .map((char, index) => {
      const atEdge = edges && (index === 0 || index === chars.length - 1) && /\s/u.test(char);
      return reserved.has(char) || UNSAFE_DISPLAY.test(char) || atEdge ? encodeChar(char) : char;
    })
    .join('');
};

const decode = (text: string): string | undefined => {
  if (/%(?![0-9A-F]{2})/.test(text)) return undefined;
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
};

const encodePath = (path: string) => encode(path, PATH_RESERVED, false);
const encodeHeading = (heading: string) => encode(heading, HEADING_RESERVED, true);

export const formatCitation = (citation: DisplayCitation): string => {
  if (!SOURCE.test(citation.sourceId)) throw new Error('invalid citation source');
  if (!isSafeRelativePath(citation.path)) throw new Error('unsafe citation path');
  if (citation.headingPath.length > MAX_HEADING_DEPTH) throw new Error('heading path too deep');
  if (
    citation.headingPath.some(
      (heading) =>
        heading.length === 0 || heading.length > MAX_HEADING_LENGTH || !isWellFormed(heading),
    )
  )
    throw new Error('invalid heading');
  if (
    !Number.isInteger(citation.headingOccurrence) ||
    citation.headingOccurrence < 1 ||
    citation.headingOccurrence > MAX_OCCURRENCE
  )
    throw new Error('invalid heading occurrence');
  if (citation.headingPath.length === 0 && citation.headingOccurrence !== 1)
    throw new Error('a citation without headings has no duplicate occurrence');
  if (
    !Number.isInteger(citation.lineStart) ||
    !Number.isInteger(citation.lineEnd) ||
    citation.lineStart < 1 ||
    citation.lineEnd > MAX_LINE ||
    citation.lineEnd < citation.lineStart
  )
    throw new Error('invalid line range');

  const headings = citation.headingPath.length
    ? `#${citation.headingPath.map(encodeHeading).join(HEADING_SEPARATOR)}${
        citation.headingOccurrence > 1 ? `~${citation.headingOccurrence}` : ''
      }`
    : '';
  return `${citation.sourceId}:${encodePath(citation.path)}${headings}@L${citation.lineStart}-${citation.lineEnd}`;
};

const fail = (reason: string): DisplayParseResult => ({ ok: false, reason });

export const parseDisplayCitation = (text: string): DisplayParseResult => {
  if (text.length > MAX_DISPLAY_LENGTH) return fail('citation too long');
  const match =
    /^([A-Za-z0-9_.-]{1,96}):([^#@]+)(?:#([^#@]+))?@L([1-9]\d{0,8})-([1-9]\d{0,8})$/.exec(text);
  if (!match) return fail('malformed citation');
  const [, sourceId = '', rawPath = '', rawHeadings, start = '', end = ''] = match;

  const path = decode(rawPath);
  if (path === undefined || !isSafeRelativePath(path)) return fail('unsafe citation path');

  let headingPath: string[] = [];
  let headingOccurrence = 1;
  if (rawHeadings !== undefined) {
    const occurrence = /~([1-9]\d{0,4})$/.exec(rawHeadings);
    const body = occurrence ? rawHeadings.slice(0, occurrence.index) : rawHeadings;
    headingOccurrence = occurrence ? Number(occurrence[1]) : 1;
    if (headingOccurrence > MAX_OCCURRENCE) return fail('heading occurrence too large');
    const parts = body.split(HEADING_SEPARATOR);
    if (parts.length > MAX_HEADING_DEPTH) return fail('heading path too deep');
    const decoded = parts.map(decode);
    if (decoded.some((part) => part === undefined || part.length === 0))
      return fail('malformed heading');
    headingPath = decoded as string[];
    if (headingPath.some((heading) => heading.length > MAX_HEADING_LENGTH))
      return fail('heading too long');
  }

  const value: DisplayCitation = {
    sourceId,
    path,
    headingPath,
    headingOccurrence,
    lineStart: Number(start),
    lineEnd: Number(end),
  };
  if (value.lineEnd < value.lineStart) return fail('line range is reversed');
  // Only the canonical spelling is accepted, so one location has exactly one display string.
  if (formatCitation(value) !== text) return fail('non-canonical citation');
  return { ok: true, value };
};
