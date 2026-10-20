import assert from 'node:assert/strict';
import test from 'node:test';

import {
  scoreBrainEvaluation,
  type EvaluationRun,
  type Citation,
  type Hit,
  type Question,
  type Observation,
} from './index.ts';

const citation = (path = 'Notes/Target.md'): Citation => ({
  sourceId: 'vault',
  path,
  headingPath: ['Section'],
});
const hit = (chunkId = 'chunk', path = 'Notes/Target.md', citationVerified = true): Hit => ({
  chunkId,
  citation: citation(path),
  citationVerified,
});
const question = (
  id = 'q',
  answerable = true,
  split: Question['split'] = 'held_out',
): Question => ({
  id,
  query: 'synthetic question',
  split,
  answerable,
  expected: answerable ? [citation()] : [],
});
const observation = (
  questionId = 'q',
  status: Observation['status'] = 'ok',
  hits: Hit[] = [hit()],
  latencyMs = 10,
): Observation => ({ questionId, status, hits, latencyMs });
const run = (overrides: Partial<EvaluationRun> = {}): EvaluationRun => ({
  evidenceKind: 'synthetic_fake',
  profileId: 'profile-a',
  chunkerVersion: 'chunker-v1',
  thresholdVersion: 'threshold-v1',
  questions: [question()],
  observations: [observation()],
  ...overrides,
});
const score = (input: unknown) => {
  const result = scoreBrainEvaluation(input);
  assert.ok(result.ok);
  return result.value;
};

await test('held-out metrics use the declared denominators and exclude calibration observations', () => {
  const questions = [
    question('calibration', true, 'calibration'),
    question('one'),
    question('two'),
    question('three'),
    question('four'),
    question('none', false),
  ];
  const observations = [
    observation('calibration', 'unavailable', [], 99999),
    observation('one'),
    observation(
      'two',
      'ok',
      [hit('noise', 'Other.md', false), hit('noise', 'Other.md', false), hit('target')],
      20,
    ),
    observation('three', 'no_match', [], 30),
    observation(
      'four',
      'ok',
      [...Array.from({ length: 5 }, (_, i) => hit(`noise${i}`, `Other${i}.md`)), hit('target')],
      40,
    ),
    observation('none', 'no_match', [], 50),
  ];
  const result = score(run({ questions, observations }));

  assert.equal(result.metrics.recallAt5, 0.5);
  assert.ok(Math.abs((result.metrics.meanReciprocalRank ?? 0) - 5 / 12) < 1e-12);
  assert.equal(result.metrics.citationAccuracy, 8 / 9);
  assert.equal(result.metrics.abstentionAccuracy, 4 / 5);
  assert.equal(result.metrics.unanswerableAbstentionRate, 1);
  assert.deepEqual(result.latencyMs, { p50: 30, p95: 50, max: 50 });
  assert.deepEqual(result.counts, {
    heldOutQuestions: 5,
    answerableQuestions: 4,
    unanswerableQuestions: 1,
    errors: 0,
    degradedQuestions: 0,
    returnedCitations: 9,
  });
});

await test('a raw recall score at the target never turns fake observations into semantic evidence', () => {
  const questions = Array.from({ length: 5 }, (_, i) => question(`q${i}`));
  const observations = questions.map((q, i) =>
    observation(q.id, i < 4 ? 'ok' : 'no_match', i < 4 ? [hit()] : []),
  );
  const result = score(run({ questions, observations }));

  assert.equal(result.metrics.recallAt5, 0.8);
  assert.deepEqual(result.acceptance, {
    recallTargetMet: true,
    semanticRecallEvidence: false,
    phase2Accepted: false,
  });
  assert.equal(
    score(run({ questions, observations, evidenceKind: 'synthetic_local_model' })).acceptance
      .semanticRecallEvidence,
    true,
  );
  assert.equal(
    score(run({ questions, observations, evidenceKind: 'real_vault_local' })).acceptance
      .phase2Accepted,
    false,
  );
});

await test('an unverified expected citation cannot inflate recall or reciprocal rank', () => {
  const result = score(
    run({ observations: [observation('q', 'ok', [hit('forged', 'Notes/Target.md', false)])] }),
  );
  assert.equal(result.metrics.recallAt5, 0);
  assert.equal(result.metrics.meanReciprocalRank, 0);
  assert.equal(result.metrics.citationAccuracy, 0);
});

await test('service failures and incomplete results never count as correct abstentions', () => {
  for (const status of ['unavailable', 'not_indexed', 'incomplete'] as const) {
    const result = score(
      run({
        questions: [question('q', false)],
        observations: [observation('q', status, [], 5000)],
        evidenceKind: 'synthetic_local_model',
      }),
    );
    assert.equal(result.metrics.unanswerableAbstentionRate, 0);
    assert.equal(result.metrics.abstentionAccuracy, 0);
    assert.equal(result.counts.errors, 1);
    assert.equal(result.acceptance.semanticRecallEvidence, false);
    assert.equal(result.latencyMs.max, 5000);
  }
});

await test('degraded lexical results are labelled and cannot certify the normal hybrid protocol', () => {
  const result = score(
    run({
      evidenceKind: 'synthetic_local_model',
      observations: [observation('q', 'lexical_only')],
    }),
  );
  assert.equal(result.metrics.recallAt5, 1);
  assert.equal(result.counts.degradedQuestions, 1);
  assert.equal(result.acceptance.semanticRecallEvidence, false);
});

await test('an incomplete result with a matching hit is still a retrieval miss', () => {
  const result = score(run({ observations: [observation('q', 'incomplete')] }));
  assert.equal(result.metrics.recallAt5, 0);
  assert.equal(result.counts.errors, 1);
  assert.equal(result.counts.degradedQuestions, 1);
});

await test('undefined denominators stay null instead of becoming perfect scores', () => {
  const result = score(
    run({ questions: [question('q', false)], observations: [observation('q', 'no_match', [])] }),
  );
  assert.equal(result.metrics.recallAt5, null);
  assert.equal(result.metrics.meanReciprocalRank, null);
  assert.equal(result.metrics.citationAccuracy, null);
  assert.equal(result.acceptance.recallTargetMet, false);
});

await test('matching uses the complete source/path/heading identity, without normalization', () => {
  const wrong = hit();
  const result = score(
    run({
      observations: [
        observation('q', 'ok', [
          { ...wrong, chunkId: 'source', citation: { ...citation(), sourceId: 'another' } },
          { ...wrong, chunkId: 'heading', citation: { ...citation(), headingPath: ['Other'] } },
          { ...wrong, chunkId: 'case', citation: citation('notes/Target.md') },
        ]),
      ],
    }),
  );
  assert.equal(result.metrics.recallAt5, 0);
});

await test('conflicting duplicate hits, duplicate/unknown/missing observations and case IDs fail validation', () => {
  const invalid = [
    run({ questions: [question(), question()] }),
    run({ observations: [] }),
    run({ observations: [observation(), observation()] }),
    run({ observations: [observation('unknown')] }),
    run({ observations: [observation('q', 'ok', [hit(), hit('chunk', 'Wrong.md')])] }),
    run({
      observations: [observation('q', 'ok', [hit(), hit('chunk', 'Notes/Target.md', false)])],
    }),
    run({ questions: [question('q', true, 'calibration')] }),
  ];
  for (const input of invalid)
    assert.deepEqual(scoreBrainEvaluation(input), {
      ok: false,
      error: { code: 'INVALID_EVALUATION_RUN' },
    });
});

await test('malformed states, absolute paths, nonfinite timings and unknown keys are rejected without echo', () => {
  const invalid = [
    run({ observations: [observation('q', 'no_match')] }),
    run({ observations: [observation('q', 'ok', [])] }),
    run({ observations: [observation('q', 'ok', [hit()], NaN)] }),
    run({ observations: [observation('q', 'ok', [hit('chunk', '../private.md')])] }),
    run({ observations: [observation('q', 'ok', [hit('chunk', '/private.md')])] }),
    { ...run(), privateSecret: 'do not echo this' },
    run({ questions: [{ ...question(), answerable: false }] }),
  ];
  for (const input of invalid) {
    const result = scoreBrainEvaluation(input);
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result), '{"ok":false,"error":{"code":"INVALID_EVALUATION_RUN"}}');
  }
});

await test('aggregate reports contain no private queries, paths, headings or case IDs', () => {
  const privateCitation = {
    sourceId: 'vault',
    path: 'Private/UniqueNote.md',
    headingPath: ['UniquePrivateHeading'],
  };
  const result = score(
    run({
      questions: [
        {
          ...question('private-case'),
          query: 'UniquePrivateQuestion',
          expected: [privateCitation],
        },
      ],
      observations: [observation('private-case', 'ok', [{ ...hit(), citation: privateCitation }])],
    }),
  );
  const text = JSON.stringify(result);
  for (const privateValue of [
    'UniquePrivateQuestion',
    'UniqueNote',
    'UniquePrivateHeading',
    'private-case',
  ])
    assert.equal(text.includes(privateValue), false);
  assert.equal(result.profileId, 'profile-a');
});

await test('calibration cases may be unobserved and never change held-out metrics', () => {
  const first = score(run());
  const second = score(run({ questions: [question(), question('dev', true, 'calibration')] }));
  assert.deepEqual(second, first);
});
