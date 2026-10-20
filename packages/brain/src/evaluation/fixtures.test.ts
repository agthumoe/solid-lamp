import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { z } from 'zod';

import { questionSchema } from './contract.ts';
import { scoreBrainEvaluation } from './index.ts';

const root = new URL('../../../../evals/brain/evaluation/', import.meta.url);

await test('hand-calculated synthetic run matches all reported aggregate metrics', async () => {
  const fixture = z
    .strictObject({ run: z.unknown(), expected: z.record(z.string(), z.number()) })
    .parse(JSON.parse(await readFile(new URL('known-run.json', root), 'utf8')) as unknown);
  const scored = scoreBrainEvaluation(fixture.run);
  assert.ok(scored.ok);
  const { value } = scored;
  for (const [name, actual] of Object.entries({ ...value.metrics, ...value.latencyMs }))
    assert.equal(actual, fixture.expected[name], name);
  assert.equal(value.acceptance.semanticRecallEvidence, false);
  assert.equal(value.acceptance.phase2Accepted, false);
});

await test('private-question template is valid question data but cannot be scored without observations', async () => {
  const template: unknown = JSON.parse(
    await readFile(new URL('private-questions.template.json', root), 'utf8'),
  );
  const validated = z.strictObject({ questions: z.array(questionSchema).min(3) }).parse(template);
  assert.ok(validated.questions.some((question) => question.split === 'calibration'));
  assert.ok(validated.questions.some((question) => !question.answerable));
  assert.equal(scoreBrainEvaluation(template).ok, false);
});
