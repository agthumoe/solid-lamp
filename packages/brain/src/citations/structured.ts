// Structured citation identity (#118, docs/specs/brain.md → Citation format). The display form is
// for people; this identity is what an excerpt is resolved against, so a citation can never be
// silently answered from a different revision, chunk set or source.
import { z } from 'zod';

// Markdown headings go to h6, so a section's heading path has at most six levels.
export const MAX_HEADING_DEPTH = 6;
export const MAX_HEADING_LENGTH = 500;
export const MAX_PATH_LENGTH = 2048;
export const MAX_OCCURRENCE = 10_000;
export const MAX_SOURCE_ID_LENGTH = 96;
export const MAX_LINE = 999_999_999;

// Worst-case length of the display form (display.ts), so wire contracts can bound it exactly:
// path characters that need escaping are ASCII (3 chars each; unsafe ones are refused), heading
// characters can be 3-byte UTF-8 controls (9 chars each), plus separators, `~N` and the range.
export const MAX_DISPLAY_LENGTH =
  MAX_SOURCE_ID_LENGTH +
  1 +
  3 * MAX_PATH_LENGTH +
  1 +
  MAX_HEADING_DEPTH * 9 * MAX_HEADING_LENGTH +
  (MAX_HEADING_DEPTH - 1) * 3 +
  1 +
  String(MAX_OCCURRENCE).length +
  2 +
  2 * String(MAX_LINE).length +
  1;

const identifier = z.string().regex(/^[A-Za-z0-9_.-]{1,96}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);

// Characters that could hide or reorder text when a citation is shown: C0/C1 controls, line and
// paragraph separators, and bidirectional embedding/override/isolate controls.
// eslint-disable-next-line no-control-regex
export const UNSAFE_DISPLAY = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

// In `u` mode `\p{Surrogate}` matches only unpaired surrogates, which cannot round-trip UTF-8.
export const isWellFormed = (text: string): boolean => !/\p{Surrogate}/u.test(text);

export const isSafeRelativePath = (path: string): boolean =>
  path.length > 0 &&
  path.length <= MAX_PATH_LENGTH &&
  !path.startsWith('/') &&
  !/^[a-z][a-z\d+.-]*:/i.test(path) &&
  !path.includes('\\') &&
  isWellFormed(path) &&
  !UNSAFE_DISPLAY.test(path) &&
  path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

export const structuredCitationSchema = z
  .strictObject({
    sourceId: identifier,
    documentId: identifier,
    revision: z.int().min(0),
    contentHash: hash,
    chunkId: identifier,
    versionId: identifier,
    path: z.string().refine(isSafeRelativePath, 'unsafe relative path'),
    headingPath: z
      .array(z.string().min(1).max(MAX_HEADING_LENGTH).refine(isWellFormed, 'lone surrogate'))
      .max(MAX_HEADING_DEPTH),
    // 1 for the first section with this heading path in the document, 2 for the next, ...
    headingOccurrence: z.int().min(1).max(MAX_OCCURRENCE),
    lineStart: z.int().min(1).max(MAX_LINE),
    lineEnd: z.int().min(1).max(MAX_LINE),
  })
  .refine((citation) => citation.lineStart <= citation.lineEnd, 'line range is reversed')
  .refine(
    (citation) => citation.headingPath.length > 0 || citation.headingOccurrence === 1,
    'a citation without headings has no duplicate occurrence',
  );

export type StructuredCitation = z.infer<typeof structuredCitationSchema>;
