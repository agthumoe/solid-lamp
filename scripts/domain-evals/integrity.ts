import { fail } from './errors.ts';
import { validateJournals } from './journals.ts';
import {
  agents,
  manifestSchema,
  paths,
  suiteSchema,
  type FixturePath,
  type Suite,
} from './schema.ts';

const domains = { 'legal-us-tx': 'legal', finance: 'finance', accountant: 'accounting' };
const prefixes = { 'legal-us-tx': 'LEG', finance: 'FIN', accountant: 'ACC' };
function unique(values: readonly string[], code: string): void {
  if (new Set(values).size !== values.length) fail(code);
}
function validateCase(entry: Suite['cases'][number], suite: Suite): void {
  if (entry.agent !== suite.agent || entry.domain !== suite.domain) fail('DOMAIN_CASE_IDENTITY');
  const expectedPrefix =
    prefixes[suite.agent] + '-' + (suite.file_kind === 'answerable' ? 'A-' : 'X-');
  if (!entry.id.startsWith(expectedPrefix)) fail('DOMAIN_CASE_IDENTITY');
  if ((suite.file_kind === 'answerable') !== (entry.answerability === 'answerable')) {
    fail('DOMAIN_ANSWERABILITY_KIND');
  }
  unique(entry.source_ids, 'DOMAIN_CASE_SOURCE_DUPLICATE');
  unique(entry.rubrics, 'DOMAIN_RUBRIC_DUPLICATE');
  const sources = new Set(suite.sources.map((source) => source.source_id));
  if (entry.source_ids.some((id) => !sources.has(id))) fail('DOMAIN_SOURCE_MISSING');
  if (
    (entry.expected.citations ?? []).some(
      (citation) => !entry.source_ids.includes(citation.source_id),
    )
  ) {
    fail('DOMAIN_CITATION_OUTSIDE_CASE');
  }
  if (
    suite.sources.some(
      (source) => entry.source_ids.includes(source.source_id) && source.document_date > entry.as_of,
    )
  )
    fail('DOMAIN_SOURCE_AFTER_AS_OF');
  if (entry.expected.journal_entries?.some((journal) => journal.date > entry.as_of))
    fail('DOMAIN_JOURNAL_AFTER_AS_OF');
  const expected = entry.expected;
  unique(expected.claims, 'DOMAIN_CLAIM_DUPLICATE');
  unique(expected.optional_claims, 'DOMAIN_CLAIM_DUPLICATE');
  if (expected.optional_claims.some((claim) => expected.claims.includes(claim)))
    fail('DOMAIN_CLAIM_OVERLAP');
  if (
    entry.answerability === 'answerable' &&
    (!expected.claims.length || !expected.citations?.length || expected.abstention.required)
  ) {
    fail('DOMAIN_ANSWERABLE_EXPECTATIONS');
  }
  if (entry.answerability === 'unanswerable' && !expected.abstention.required)
    fail('DOMAIN_ABSTENTION_REQUIRED');
  if (
    entry.answerability === 'adversarial' &&
    !expected.must_not.length &&
    !expected.premise_correction
  ) {
    fail('DOMAIN_ADVERSARIAL_EXPECTATIONS');
  }
  validateJournals(entry, suite.sources);
}
export function validateDomainData(
  rawManifest: unknown,
  rawFiles: ReadonlyMap<FixturePath, unknown>,
) {
  const manifest = manifestSchema.parse(rawManifest);
  unique(
    manifest.files.map((file) => file.path),
    'DOMAIN_MANIFEST_PATH_DUPLICATE',
  );
  if (rawFiles.size !== paths.length || paths.some((path) => !rawFiles.has(path)))
    fail('DOMAIN_FILE_SET');
  const globalIds = new Set<string>();
  const globalSources = new Map<string, string>();
  const policies = new Map<string, string>();
  const parsed = new Map<FixturePath, Suite>();
  for (const file of manifest.files) {
    const suite = suiteSchema.parse(rawFiles.get(file.path));
    if (
      suite.agent !== file.agent ||
      suite.domain !== domains[suite.agent] ||
      file.path !== suite.agent + '/' + suite.file_kind + '.json'
    )
      fail('DOMAIN_FILE_IDENTITY');
    const policy = policies.get(suite.agent);
    if (policy !== undefined && policy !== suite.agent_policy) fail('DOMAIN_POLICY_MISMATCH');
    policies.set(suite.agent, suite.agent_policy);
    unique(
      suite.sources.map((source) => source.source_id),
      'DOMAIN_SOURCE_DUPLICATE',
    );
    for (const source of suite.sources) {
      if (!source.status_flags.includes('synthetic')) fail('DOMAIN_SOURCE_NOT_SYNTHETIC');
      if (
        source.effective_from &&
        source.effective_to &&
        source.effective_from > source.effective_to
      ) {
        fail('DOMAIN_SOURCE_DATE_RANGE');
      }
      const serialized = JSON.stringify(source);
      const previous = globalSources.get(source.source_id);
      if (previous !== undefined && previous !== serialized)
        fail('DOMAIN_SOURCE_DEFINITION_MISMATCH');
      globalSources.set(source.source_id, serialized);
    }
    const counts = { answerable: 0, adversarial: 0, unanswerable: 0 };
    for (const entry of suite.cases) {
      if (globalIds.has(entry.id)) fail('DOMAIN_CASE_DUPLICATE');
      globalIds.add(entry.id);
      validateCase(entry, suite);
      counts[entry.answerability]++;
    }
    if (
      file.cases !== suite.cases.length ||
      file.sources !== suite.sources.length ||
      Object.entries(counts).some(
        ([kind, count]) => (file.by_answerability[kind as keyof typeof counts] ?? 0) !== count,
      )
    ) {
      fail('DOMAIN_MANIFEST_FILE_COUNTS');
    }
    parsed.set(file.path, suite);
  }
  for (const agent of agents) {
    const cases = [...parsed.values()]
      .filter((suite) => suite.agent === agent)
      .flatMap((suite) => suite.cases);
    const observed = {
      answerable: cases.filter((entry) => entry.answerability === 'answerable').length,
      adversarial_or_unanswerable: cases.filter((entry) => entry.answerability !== 'answerable')
        .length,
      with_calculation: cases.filter((entry) => entry.expected.calculation !== null).length,
      with_journal_entries: cases.filter((entry) => entry.expected.journal_entries?.length).length,
      requires_abstention: cases.filter((entry) => entry.expected.abstention.required).length,
    };
    if (observed.answerable < 40 || observed.adversarial_or_unanswerable < 20)
      fail('DOMAIN_MINIMUM_COUNTS');
    for (const key of Object.keys(observed) as (keyof typeof observed)[]) {
      if (observed[key] !== manifest.totals[agent][key]) fail('DOMAIN_MANIFEST_TOTALS');
    }
  }
  return { manifest, suites: parsed, cases: globalIds.size };
}
