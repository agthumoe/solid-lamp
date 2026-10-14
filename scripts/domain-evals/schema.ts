import { z } from 'zod';

const text = z.string().min(1);
export const agents = ['legal-us-tx', 'finance', 'accountant'] as const;
const agent = z.enum(agents);
const domain = z.enum(['legal', 'finance', 'accounting']);
const sourceId = z.string().regex(/^SYN-[A-Z0-9-]+$/);
export const money = z.string().regex(/^(?:0|[1-9][0-9]*)\.[0-9]{2}$/);
const day = z.iso.date();
const rubric = z.enum([
  'CORE-GROUND',
  'CORE-CITE',
  'CORE-CALC',
  'CORE-DATE',
  'CORE-ABSTAIN',
  'CORE-INJECT',
  'CORE-SCOPE',
  'LEGAL-AUTH',
  'LEGAL-JURIS',
  'FIN-UNITS',
  'FIN-SOURCE',
  'FIN-ASSUMP',
  'ACC-ENTRY',
  'ACC-EVIDENCE',
  'ACC-POLICY',
  'ACC-NOWRITE',
]);
const abstention = z.discriminatedUnion('required', [
  z.strictObject({ required: z.literal(false) }),
  z.strictObject({
    required: z.literal(true),
    reason: z.enum([
      'missing_source',
      'wrong_jurisdiction',
      'superseded_only',
      'out_of_scope',
      'stale_data',
      'insufficient_facts',
      'unit_or_currency_mismatch',
      'unsafe_action_request',
      'policy_undefined',
    ]),
    acceptable: text,
  }),
]);
export const sourceSchema = z.strictObject({
  synthetic: z.literal(true),
  retrieved_at: z.iso.datetime(),
  source_id: sourceId,
  title: z.string().startsWith('[SYNTHETIC]'),
  authority: text,
  jurisdiction: text,
  document_date: day,
  effective_from: day.nullable(),
  effective_to: day.nullable(),
  version: text.optional(),
  status_flags: z.array(text).min(1),
  text,
});
const calculation = z
  .strictObject({
    description: text,
    inputs: z.record(text, z.json()),
    formula: text,
    result: text,
    unit: text,
    rounding: text,
  })
  .refine(
    (value) => {
      if (value.unit !== 'date') return true;
      const dates = value.result.split(' | ');
      return dates.length <= 2 && dates.every((date) => day.safeParse(date).success);
    },
    { message: 'Invalid date calculation result', path: ['result'] },
  );
const entry = z.strictObject({
  date: day,
  memo: text,
  total: money,
  lines: z
    .array(
      z.strictObject({
        account: z.string().regex(/^[0-9]{4}$/),
        name: text,
        debit: money,
        credit: money,
      }),
    )
    .min(2),
});
const expected = z.strictObject({
  calculation: calculation.nullable(),
  claims: z.array(text),
  optional_claims: z.array(text),
  citations: z.array(z.strictObject({ source_id: sourceId, locator: text })).optional(),
  journal_entries: z.array(entry).optional(),
  abstention,
  must_not: z.array(text),
  premise_correction: text.optional(),
});
export const suiteSchema = z.strictObject({
  schema_version: z.literal(2),
  prompt_version: z.literal('v2'),
  task: z.literal('#20'),
  agent,
  domain,
  file_kind: z.enum(['answerable', 'adversarial']),
  notice: text,
  agent_policy: text,
  sources: z.array(sourceSchema).min(1),
  cases: z
    .array(
      z.strictObject({
        id: z.string().regex(/^(?:LEG|FIN|ACC)-(?:A|X)-[0-9]{3}$/),
        agent,
        domain,
        synthetic: z.literal(true),
        as_of: day,
        category: text,
        answerability: z.enum(['answerable', 'unanswerable', 'adversarial']),
        source_ids: z.array(sourceId),
        question: text,
        expected,
        rubrics: z.array(rubric).min(1),
        tags: z.array(text).optional(),
      }),
    )
    .min(1),
});
export const paths = [
  'legal-us-tx/answerable.json',
  'legal-us-tx/adversarial.json',
  'finance/answerable.json',
  'finance/adversarial.json',
  'accountant/answerable.json',
  'accountant/adversarial.json',
] as const;
const count = z.number().int().nonnegative();
const totals = z.strictObject({
  answerable: count,
  adversarial_or_unanswerable: count,
  with_calculation: count,
  with_journal_entries: count,
  requires_abstention: count,
});
export const manifestSchema = z.strictObject({
  schema_version: z.literal(2),
  task: z.literal('https://github.com/agthumoe/solid-lamp/issues/20'),
  generated_on: day,
  synthetic_only: z.literal(true),
  files: z
    .array(
      z.strictObject({
        path: z.enum(paths),
        agent,
        cases: count,
        sources: count,
        by_answerability: z.partialRecord(
          z.enum(['answerable', 'adversarial', 'unanswerable']),
          count,
        ),
      }),
    )
    .length(6),
  totals: z.strictObject({ 'legal-us-tx': totals, finance: totals, accountant: totals }),
});
export type Suite = z.infer<typeof suiteSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type FixturePath = (typeof paths)[number];
