// Integrity of the synthetic book/official-source fixtures (#114). The future parser must
// reproduce manifest.json; this test keeps the fixtures internally consistent, keeps the PDFs
// byte-identical to their generator, and pins the spec's status rules with a reference oracle.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { z } from 'zod';

import { buildPdf, PDF_FIXTURES } from './make-pdf-fixtures.ts';

const root = resolve(import.meta.dirname, '../../evals/brain/sources');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const status = z.enum(['current', 'superseded', 'not_yet_effective', 'proposed', 'stale']);

const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  evaluationDates: z.array(date).min(1),
  stalenessDays: z.int().positive(),
  books: z.array(
    z.discriminatedUnion('kind', [
      z.strictObject({
        id: z.string(),
        kind: z.literal('book_epub'),
        path: z.string(),
        title: z.string(),
        creators: z.array(z.string()),
        publisher: z.string(),
        edition: z.string(),
        year: z.int(),
        language: z.string(),
        identifier: z.string().nullable(),
        spine: z.array(
          z.strictObject({
            item: z.string(),
            href: z.string(),
            chapter: z.string(),
            pages: z.array(z.string()),
            snippets: z.array(z.string()),
            footnotes: z.array(
              z.strictObject({ ref: z.string(), id: z.string(), text: z.string() }),
            ),
            captions: z.array(z.string()),
            injection: z.strictObject({ id: z.string(), text: z.string() }).optional(),
          }),
        ),
      }),
      z.strictObject({
        id: z.string(),
        kind: z.literal('book_pdf'),
        path: z.string(),
        title: z.string(),
        pages: z.array(
          z.strictObject({ index: z.int(), label: z.string(), snippets: z.array(z.string()) }),
        ),
        quarantinedPages: z.array(z.int()),
        heldForReview: z.boolean(),
      }),
    ]),
  ),
  official: z.array(
    z.strictObject({
      id: z.string(),
      path: z.string(),
      authority: z.string(),
      jurisdiction: z.enum(['US-TX', 'US-federal']),
      citation: z.string(),
      document_date: date,
      effective_from: date.nullable(),
      effective_to: date.nullable(),
      retrieved_at: date,
      flags: z.array(z.string()),
      expectedStatus: z.record(date, z.array(status)),
    }),
  ),
});

const manifest = manifestSchema.parse(
  JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')),
);
const text = (path: string) => readFileSync(join(root, path), 'utf8');
// Visible text of an XHTML fragment, for snippet checks (the real parser will use an XML parser).
const visible = (xhtml: string) => xhtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

await test('every manifest path exists', () => {
  for (const entry of [...manifest.books, ...manifest.official])
    assert.ok(existsSync(join(root, entry.path)), entry.path);
});

await test('the EPUB is structurally consistent with its manifest expectations', () => {
  for (const book of manifest.books) {
    if (book.kind !== 'book_epub') continue;
    const base = book.path;
    assert.equal(text(`${base}/mimetype`), 'application/epub+zip');
    const container = text(`${base}/META-INF/container.xml`);
    const opfPath = /full-path="([^"]+)"/.exec(container)?.[1];
    assert.equal(opfPath, 'OEBPS/content.opf');
    const opf = text(`${base}/${opfPath}`);
    assert.match(opf, new RegExp(`<dc:title>${book.title}</dc:title>`));
    const items = new Map(
      [...opf.matchAll(/<item id="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]),
    );
    for (const href of items.values())
      assert.ok(existsSync(join(root, base, 'OEBPS', href ?? '')), href);
    const spine = [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(
      spine,
      book.spine.map((entry) => entry.item),
    );
    const nav = text(`${base}/OEBPS/nav.xhtml`);

    for (const entry of book.spine) {
      const xhtml = text(`${base}/${entry.href}`);
      const body = visible(xhtml);
      assert.ok(nav.includes(`>${entry.chapter}</a>`), `${entry.item} nav title`);
      assert.ok(xhtml.includes(`<h1>${entry.chapter}</h1>`), `${entry.item} heading`);
      for (const snippet of entry.snippets) assert.ok(body.includes(snippet), snippet);
      for (const page of entry.pages)
        assert.match(
          xhtml,
          new RegExp(`epub:type="pagebreak" title="${page}"`),
          `${entry.item} page ${page}`,
        );
      for (const note of entry.footnotes) {
        assert.match(
          xhtml,
          new RegExp(`<p id="${note.ref}">[^]*?href="#${note.id}"`),
          'noteref in its paragraph',
        );
        assert.match(
          xhtml,
          new RegExp(`<aside id="${note.id}" epub:type="footnote">`),
          'footnote aside',
        );
        assert.ok(body.includes(note.text));
      }
      for (const caption of entry.captions)
        assert.ok(xhtml.includes(`<figcaption>${caption}</figcaption>`));
      if (entry.injection)
        assert.ok(
          xhtml.includes(`<p id="${entry.injection.id}">${entry.injection.text}</p>`),
          'injection kept verbatim',
        );
    }
  }
});

await test('the committed PDFs are byte-identical to the deterministic generator', () => {
  for (const [name, spec] of Object.entries(PDF_FIXTURES))
    assert.ok(readFileSync(join(root, 'pdf', name)).equals(buildPdf(spec)), `${name} drifted`);
  assert.ok(
    buildPdf(PDF_FIXTURES['orchard-handbook.pdf'] ?? { title: '', pages: [] }).equals(
      buildPdf(PDF_FIXTURES['orchard-handbook.pdf'] ?? { title: '', pages: [] }),
    ),
  );
});

await test('PDF pages, labels and quarantine expectations match the generator specs', () => {
  for (const book of manifest.books) {
    if (book.kind !== 'book_pdf') continue;
    const spec = PDF_FIXTURES[book.path.replace('pdf/', '')];
    assert.ok(spec, book.path);
    assert.equal(spec.title, book.title);
    assert.equal(spec.pages.length, book.pages.length);
    const textless = spec.pages.flatMap((page, index) => (page.lines === null ? [index] : []));
    assert.deepEqual(textless, book.quarantinedPages);
    // Spec rule: more than 2% quarantined pages holds the book for review.
    assert.equal(book.heldForReview, textless.length / spec.pages.length > 0.02);
    for (const page of book.pages) {
      const lines = spec.pages[page.index]?.lines ?? [];
      for (const snippet of page.snippets) assert.ok(lines.join('\n').includes(snippet), snippet);
    }
    const roman = ['i', 'ii', 'iii', 'iv', 'v'];
    const labelFor = (index: number) => {
      const range = [...(spec.labels ?? [])].reverse().find((entry) => entry.from <= index);
      if (!range) return String(index + 1);
      const n = range.start + index - range.from;
      return range.style === 'r' ? (roman[n - 1] ?? String(n)) : String(n);
    };
    assert.deepEqual(
      book.pages.map((page) => labelFor(page.index)),
      book.pages.map((page) => page.label),
    );
  }
});

// Reference oracle for the spec's freshness rules (docs/specs/book-official-sources.md).
const statusAt = (entry: (typeof manifest.official)[number], at: string, stalenessDays: number) => {
  const result: string[] = [];
  if (entry.flags.includes('proposed')) result.push('proposed');
  else if (entry.effective_from && entry.effective_from > at) result.push('not_yet_effective');
  else if (entry.effective_to && entry.effective_to <= at) result.push('superseded');
  else result.push('current');
  const age = (Date.parse(at) - Date.parse(entry.retrieved_at)) / 86_400_000;
  if (age > stalenessDays) result.push('stale');
  return result;
};

await test('official snapshots: banner, expected status at each evaluation date, no overlapping periods', () => {
  for (const entry of manifest.official) {
    assert.ok(text(entry.path).includes('FICTIONAL — NOT LAW'), `${entry.id} banner`);
    for (const at of manifest.evaluationDates)
      assert.deepEqual(
        statusAt(entry, at, manifest.stalenessDays),
        entry.expectedStatus[at],
        `${entry.id} @ ${at}`,
      );
  }
  const byCitation = new Map<string, (typeof manifest.official)[number][]>();
  for (const entry of manifest.official.filter((o) => o.effective_from))
    byCitation.set(entry.citation, [...(byCitation.get(entry.citation) ?? []), entry]);
  for (const [citation, versions] of byCitation) {
    const sorted = [...versions].sort((a, b) =>
      (a.effective_from ?? '').localeCompare(b.effective_from ?? ''),
    );
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      assert.ok(previous?.effective_to, `${citation}: open-ended version followed by another`);
      assert.ok(
        previous.effective_to <= (sorted[i]?.effective_from ?? ''),
        `${citation}: overlapping periods`,
      );
    }
  }
});
