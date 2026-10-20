// `pnpm run brain:pdf-fixtures` (#114): deterministic synthetic PDFs for the future book parser.
// Hand-assembled PDF 1.4 (no timestamps, no IDs) so regeneration is byte-identical; the check
// in source-fixtures.test.ts compares the committed files with a fresh build.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type PdfPage = {
  // Text lines drawn with Helvetica; `null` draws only shapes (no text layer, like a scan).
  readonly lines: readonly string[] | null;
};

export type PdfSpec = {
  readonly title: string;
  readonly pages: readonly PdfPage[];
  // PDF /PageLabels: [startIndex, style, firstNumber] ranges, e.g. roman front matter.
  readonly labels?: readonly {
    readonly from: number;
    readonly style: 'r' | 'D';
    readonly start: number;
  }[];
};

const escape = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`);

const contentStream = (page: PdfPage): string => {
  if (page.lines === null)
    // A drawn rectangle only: a parser must find no extractable text here.
    return 'q 0.6 g 72 300 468 400 re f Q\n';
  const ops = ['BT', '/F1 12 Tf', '14 TL', '72 720 Td'];
  page.lines.forEach((line, index) => ops.push(`${index ? 'T* ' : ''}(${escape(line)}) Tj`));
  ops.push('ET');
  return `${ops.join('\n')}\n`;
};

export const buildPdf = (spec: PdfSpec): Buffer => {
  const objects: string[] = [];
  const pageIds: number[] = [];
  // Object numbers: 1 catalog, 2 pages, 3 font, 4 info, then a (page, content) pair per page.
  spec.pages.forEach((page, index) => {
    const pageId = 5 + index * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const stream = contentStream(page);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] =
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`;
  });
  const labels = spec.labels?.length
    ? ` /PageLabels << /Nums [${spec.labels
        .map((label) => `${label.from} << /S /${label.style} /St ${label.start} >>`)
        .join(' ')}] >>`
    : '';
  objects[1] = `<< /Type /Catalog /Pages 2 0 R${labels} >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = `<< /Title (${escape(spec.title)}) /Producer (aetherion synthetic fixture) >>`;

  let body = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(body, 'latin1');
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++)
    body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
};

export const PDF_FIXTURES: Readonly<Record<string, PdfSpec>> = {
  'orchard-handbook.pdf': {
    title: 'Orchard Keeping Handbook (synthetic)',
    labels: [
      { from: 0, style: 'r', start: 1 },
      { from: 2, style: 'D', start: 1 },
    ],
    pages: [
      { lines: ['Orchard Keeping Handbook', 'A synthetic fixture. Not a real book.'] },
      { lines: ['Contents', '1. Soil for silver pears', '2. Watering by starlight'] },
      {
        lines: [
          '1. Soil for silver pears',
          'Silver pears need loam mixed with crushed chalk (one part in nine).',
        ],
      },
      {
        lines: [
          '2. Watering by starlight',
          'Water only when at least three stars are visible (a fictional rule).',
        ],
      },
    ],
  },
  'scanned-notice.pdf': {
    title: 'Scanned Notice (synthetic)',
    pages: [{ lines: ['Notice: this first page has a real text layer.'] }, { lines: null }],
  },
};

const target = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  'evals/brain/sources/pdf',
);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await mkdir(target, { recursive: true });
  for (const [name, spec] of Object.entries(PDF_FIXTURES)) {
    await writeFile(join(target, name), buildPdf(spec));
    console.log(`wrote evals/brain/sources/pdf/${name}`);
  }
}
