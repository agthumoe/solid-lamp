import assert from 'node:assert/strict';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { z } from 'zod';
import { safeError } from './errors.ts';
import { validateDomainData } from './integrity.ts';
import { cents } from './journals.ts';
import { loadDomainData } from './load.ts';
import { manifestSchema, paths, suiteSchema, type FixturePath } from './schema.ts';

const root = fileURLToPath(new URL('../../evals/domain/', import.meta.url));
function data() {
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')),
  );
  const files = new Map(
    paths.map((path) => [
      path,
      suiteSchema.parse(JSON.parse(readFileSync(join(root, path), 'utf8'))),
    ]),
  );
  return { manifest, files };
}
function fixture(path: FixturePath = 'accountant/answerable.json') {
  const result = data();
  const suite = result.files.get(path);
  assert.ok(suite);
  const entry = suite.cases[0];
  assert.ok(entry);
  return { ...result, suite, entry };
}
await test('reviewed baseline passes with 180 cases and approved manifest totals', () => {
  const result = loadDomainData(root);
  assert.equal(result.cases, 180);
  const totals = Object.values(result.manifest.totals);
  assert.equal(
    totals.reduce((sum, item) => sum + item.with_calculation, 0),
    82,
  );
  assert.equal(
    totals.reduce((sum, item) => sum + item.with_journal_entries, 0),
    32,
  );
  assert.equal(
    totals.reduce((sum, item) => sum + item.requires_abstention, 0),
    28,
  );
});
await test('strict schemas reject unsupported versions, unknown keys, dates and vocabularies', () => {
  const { manifest, files, suite, entry } = fixture();
  assert.throws(() => validateDomainData({ ...manifest, schema_version: 1 }, files));
  assert.throws(() => suiteSchema.parse({ ...suite, unknown: true }));
  assert.throws(() => suiteSchema.parse({ ...suite, schema_version: 3 }));
  assert.throws(() => suiteSchema.parse({ ...suite, prompt_version: 'v1' }));
  entry.as_of = '2026-02-30';
  assert.throws(() => validateDomainData(manifest, files));
  assert.throws(() =>
    suiteSchema.parse({ ...suite, cases: [{ ...entry, as_of: '2026-01-01', rubrics: ['TYPO'] }] }),
  );
  assert.throws(() =>
    suiteSchema.parse({
      ...suite,
      cases: [
        {
          ...entry,
          as_of: '2026-01-01',
          expected: {
            ...entry.expected,
            abstention: { required: true, reason: 'TYPO', acceptable: 'Ask' },
          },
        },
      ],
    }),
  );
});
await test('manifest paths/counts are exact and cannot traverse or omit files', () => {
  const { manifest, files } = data();
  const first = manifest.files[0];
  assert.ok(first);
  assert.throws(() =>
    validateDomainData(
      { ...manifest, files: [{ ...first, path: '../secret.json' }, ...manifest.files.slice(1)] },
      files,
    ),
  );
  assert.throws(() =>
    validateDomainData({ ...manifest, files: [first, first, ...manifest.files.slice(2)] }, files),
  );
  first.cases++;
  assert.throws(() => validateDomainData(manifest, files), /FILE_COUNTS/);
  files.delete('finance/adversarial.json');
  assert.throws(() => validateDomainData(manifest, files), /FILE_SET/);
});
await test('case/source duplicates, agent identity and definitions cannot drift', () => {
  const { manifest, files, suite, entry } = fixture();
  suite.cases.push(structuredClone(entry));
  assert.throws(() => validateDomainData(manifest, files), /CASE_DUPLICATE/);
  suite.cases.pop();
  entry.agent = 'finance';
  assert.throws(() => validateDomainData(manifest, files), /CASE_IDENTITY/);
  entry.agent = 'accountant';
  const source = suite.sources[0];
  assert.ok(source);
  suite.sources.push(structuredClone(source));
  assert.throws(() => validateDomainData(manifest, files), /SOURCE_DUPLICATE/);
  suite.sources.pop();
  source.text += ' changed';
  assert.throws(() => validateDomainData(manifest, files), /DEFINITION_MISMATCH/);
});
await test('policy and date-range inconsistencies are rejected without printing source text', () => {
  const { manifest, files, suite } = fixture();
  suite.agent_policy += ' PRIVATE_SENTINEL';
  assert.throws(() => validateDomainData(manifest, files), /POLICY_MISMATCH/);
  const next = fixture();
  const source = next.suite.sources[0];
  assert.ok(source);
  source.effective_from = '2026-12-31';
  source.effective_to = '2026-01-01';
  assert.throws(() => validateDomainData(next.manifest, next.files), /DATE_RANGE/);
});
await test('source and citation references are restricted to the supplied case', () => {
  const { manifest, files, entry } = fixture();
  entry.source_ids.push('SYN-NOT-PROVIDED');
  assert.throws(() => validateDomainData(manifest, files), /SOURCE_MISSING/);
  entry.source_ids.pop();
  entry.expected.citations = [{ source_id: 'SYN-NOT-PROVIDED', locator: 'fake' }];
  assert.throws(() => validateDomainData(manifest, files), /CITATION_OUTSIDE_CASE/);
});
await test('answerability, abstention and adversarial expectations are required', () => {
  const { manifest, files, entry } = fixture();
  entry.expected.claims = [];
  assert.throws(() => validateDomainData(manifest, files), /ANSWERABLE_EXPECTATIONS/);
  const adversarial = fixture('finance/adversarial.json');
  const unanswerable = adversarial.suite.cases.find(
    (entry) => entry.answerability === 'unanswerable',
  );
  assert.ok(unanswerable);
  unanswerable.expected.abstention = { required: false };
  assert.throws(
    () => validateDomainData(adversarial.manifest, adversarial.files),
    /ABSTENTION_REQUIRED/,
  );
  const next = fixture('finance/adversarial.json');
  const attack = next.suite.cases.find((entry) => entry.answerability === 'adversarial');
  assert.ok(attack);
  attack.expected.must_not = [];
  delete attack.expected.premise_correction;
  assert.throws(() => validateDomainData(next.manifest, next.files), /ADVERSARIAL_EXPECTATIONS/);
});
await test('optional claims are not required and cannot duplicate required claims', () => {
  const { manifest, files, entry } = fixture();
  const claim = entry.expected.claims[0];
  assert.ok(claim);
  entry.expected.optional_claims = [claim];
  assert.throws(() => validateDomainData(manifest, files), /CLAIM_OVERLAP/);
  entry.expected.optional_claims = ['Optional reviewed observation'];
  assert.doesNotThrow(() => validateDomainData(manifest, files));
});
await test('journal balances, totals, account codes and names are exact', () => {
  for (const change of ['debit', 'total', 'account', 'name'] as const) {
    const { manifest, files, entry } = fixture();
    const journal = entry.expected.journal_entries?.[0];
    assert.ok(journal);
    const line = journal.lines[0];
    assert.ok(line);
    if (change === 'total') journal.total = '1.00';
    else if (change === 'debit') line.debit = '1.00';
    else if (change === 'account') line.account = '9999';
    else line.name = 'Unrecognized account';
    assert.throws(() => validateDomainData(manifest, files));
  }
});
await test('negative, zero-only and two-sided journal lines are invalid', () => {
  for (const [debit, credit] of [
    ['-1.00', '0.00'],
    ['0.00', '0.00'],
    ['1.00', '1.00'],
  ]) {
    const { manifest, files, entry } = fixture();
    const line = entry.expected.journal_entries?.[0]?.lines[0];
    assert.ok(line);
    assert.ok(debit && credit);
    line.debit = debit;
    line.credit = credit;
    assert.throws(() => validateDomainData(manifest, files));
  }
});
await test('chart grammar rejects unknown trailing content instead of partially parsing', () => {
  const { manifest, files, suite } = fixture();
  const chart = suite.sources.find((source) => source.source_id === 'SYN-BAKERY-COA');
  assert.ok(chart);
  // Apply identical public source change in both copies, preserving cross-file identity.
  const malformed = chart.text.slice(0, -1) + '; malformed.';
  for (const item of files.values()) {
    const source = item.sources.find((source) => source.source_id === chart.source_id);
    if (source) source.text = malformed;
  }
  assert.throws(() => validateDomainData(manifest, files), /CHART_INVALID/);
});
await test('integer cents reconcile values beyond binary floating-point safe range', () => {
  assert.equal(cents('9007199254740993.01'), 900719925474099301n);
  const { manifest, files, entry } = fixture();
  const journal = entry.expected.journal_entries?.[0];
  assert.ok(journal);
  journal.total = '9007199254740993.01';
  journal.lines = [
    { account: '1000', name: 'Cash', debit: journal.total, credit: '0.00' },
    { account: '4000', name: 'Sales Revenue', debit: '0.00', credit: journal.total },
  ];
  assert.doesNotThrow(() => validateDomainData(manifest, files));
});
await test('aggregate totals and minimum domain counts are independently checked', () => {
  const { manifest, files } = data();
  manifest.totals.finance.with_calculation++;
  assert.throws(() => validateDomainData(manifest, files), /MANIFEST_TOTALS/);
  const next = fixture('finance/answerable.json');
  next.suite.cases.pop();
  const row = next.manifest.files.find((file) => file.path === 'finance/answerable.json');
  assert.ok(row);
  row.cases--;
  row.by_answerability.answerable = 39;
  assert.throws(() => validateDomainData(next.manifest, next.files), /MINIMUM_COUNTS/);
});
await test('filesystem/JSON failures are rejected and diagnostics cannot expose private input', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aetherion-domain-integrity-'));
  try {
    const copied = join(directory, 'fixtures');
    cpSync(root, copied, { recursive: true });
    const target = join(copied, 'finance', 'answerable.json');
    unlinkSync(target);
    symlinkSync(join(root, 'finance', 'answerable.json'), target);
    assert.throws(() => loadDomainData(copied), /FILE_BOUNDARY/);
    unlinkSync(target);
    writeFileSync(target, '{PRIVATE_SENTINEL');
    assert.throws(() => loadDomainData(copied), SyntaxError);
    const bad = z.strictObject({ known: z.string() }).safeParse({ PRIVATE_SENTINEL: true });
    assert.ok(!bad.success);
    assert.equal(safeError(bad.error).includes('PRIVATE_SENTINEL'), false);
    assert.equal(safeError(new Error('PRIVATE_SENTINEL')), 'DOMAIN_READ_FAILED');
    assert.equal(safeError(new SyntaxError('PRIVATE_SENTINEL')), 'DOMAIN_JSON_INVALID');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

await test('case as_of excludes future documents but allows documents on the same day', () => {
  const { manifest, files, suite, entry } = fixture('finance/answerable.json');
  const latest = suite.sources
    .filter((source) => entry.source_ids.includes(source.source_id))
    .map((source) => source.document_date)
    .sort()
    .at(-1);
  assert.ok(latest);
  entry.as_of = latest;
  assert.doesNotThrow(() => validateDomainData(manifest, files));
  entry.as_of = '1900-01-01';
  assert.throws(() => validateDomainData(manifest, files), /SOURCE_AFTER_AS_OF/);
});
await test('journal dates cannot exceed as_of and equality is valid', () => {
  const { manifest, files, suite } = fixture();
  const entry = suite.cases.find((entry) => entry.expected.journal_entries?.length);
  assert.ok(entry);
  const journal = entry.expected.journal_entries?.[0];
  assert.ok(journal);
  journal.date = entry.as_of;
  assert.doesNotThrow(() => validateDomainData(manifest, files));
  journal.date = '9999-12-31';
  assert.throws(() => validateDomainData(manifest, files), /JOURNAL_AFTER_AS_OF/);
});
await test('date results accept ISO single/conditional dates and reject invalid calendars or syntax', () => {
  const { manifest, files, suite } = fixture('legal-us-tx/adversarial.json');
  const calculation = suite.cases.find((entry) => entry.expected.calculation?.unit === 'date')
    ?.expected.calculation;
  assert.ok(calculation);
  for (const result of ['2024-02-29', '2026-08-22 | 2026-08-31']) {
    calculation.result = result;
    assert.doesNotThrow(() => validateDomainData(manifest, files));
  }
  for (const result of [
    'soon',
    '2026-02-29',
    '2026-13-01',
    '2026-08-22 | soon',
    '2026-08-22|2026-08-31',
    '2026-08-22 | 2026-08-31 | 2026-09-01',
  ]) {
    calculation.result = result;
    assert.throws(() => validateDomainData(manifest, files), z.ZodError);
  }
});
