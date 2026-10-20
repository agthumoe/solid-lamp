// The codec's output must always fit the shared wire contract (#125 review): a citation the
// domain accepts can never make a search response fail validation as BAD_RESPONSE.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRAIN_CITATION_DISPLAY_MAX_CHARS,
  BRAIN_HEADING_MAX_DEPTH,
  BRAIN_LINE_MAX,
  brainCitationSchema,
} from '@aetherion/shared/contracts';

import { formatCitation, MAX_CITATION_DISPLAY_LENGTH, structuredCitationSchema } from './index.ts';
import { MAX_HEADING_DEPTH, MAX_LINE } from './structured.ts';

const toWire = (identity: Parameters<typeof structuredCitationSchema.parse>[0]) => {
  const citation = structuredCitationSchema.parse(identity);
  return brainCitationSchema.safeParse({ ...citation, display: formatCitation(citation) });
};

const base = {
  sourceId: 'vault',
  documentId: 'doc-1',
  revision: 1,
  contentHash: 'a'.repeat(64),
  chunkId: 'chunk-1',
  versionId: 'v-1',
  path: 'note.md',
  headingPath: ['Top'],
  headingOccurrence: 1,
  lineStart: 1,
  lineEnd: 2,
};

await test('domain and wire bounds are the same numbers', () => {
  assert.equal(MAX_CITATION_DISPLAY_LENGTH, BRAIN_CITATION_DISPLAY_MAX_CHARS);
  assert.equal(MAX_HEADING_DEPTH, BRAIN_HEADING_MAX_DEPTH);
  assert.equal(MAX_LINE, BRAIN_LINE_MAX);
});

await test('the review case and the worst case both serialize through the wire contract', () => {
  // Six 500-character headings of `@`: valid in the domain, 9,034 display characters.
  assert.ok(toWire({ ...base, headingPath: Array(6).fill('@'.repeat(500)) }).success);
  const worst = toWire({
    ...base,
    sourceId: 's'.repeat(96),
    path: `${'%'.repeat(2044)}.md`,
    headingPath: Array(6).fill('\u2028'.repeat(500)),
    headingOccurrence: 10_000,
    lineStart: 999_999_999,
    lineEnd: 999_999_999,
  });
  assert.ok(worst.success, JSON.stringify(worst.error?.issues.slice(0, 2)));
});
