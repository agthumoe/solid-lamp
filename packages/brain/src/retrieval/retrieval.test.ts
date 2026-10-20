import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyEvidenceGates,
  calibrateEvidenceGates,
  CalibrationInputError,
  freezeGates,
  fuseRankings,
  type CalibrationSet,
  type FusedCandidate,
} from './index.ts';

await test('RRF matches hand-computed scores with k = 60', () => {
  const fused = fuseRankings(
    [
      { chunkId: 'a', cosine: 0.9 },
      { chunkId: 'b', cosine: 0.8 },
      { chunkId: 'c', cosine: 0.7 },
    ],
    [
      { chunkId: 'c', score: 0.5 },
      { chunkId: 'd', score: 0.4 },
    ],
    { limit: 10 },
  );

  assert.deepEqual(
    fused.map((f) => [f.chunkId, f.vectorRank, f.lexicalRank]),
    [
      ['c', 3, 1], // 1/63 + 1/61
      ['a', 1, null], // 1/61
      ['b', 2, null], // 1/62, tied with d on score and best rank: chunk ID decides
      ['d', null, 2],
    ],
  );
  assert.equal(fused[0]?.fusedScore, 1 / 63 + 1 / 61);
  assert.equal(fused[1]?.fusedScore, 1 / 61);
  assert.deepEqual(
    fused.map((f) => [f.cosine, f.lexical]),
    [
      [0.7, 0.5],
      [0.9, null],
      [0.8, null],
      [null, 0.4],
    ],
  );
});

await test('ties break by best single-branch rank, then chunk ID in code-unit order', () => {
  // Z: vector rank 1 only; a: lexical rank 1 only → equal score and best rank; code-unit order
  // decides ('Z' 0x5A before 'a' 0x61), where a locale comparison would put 'a' first.
  const single = fuseRankings([{ chunkId: 'a', cosine: 0.5 }], [{ chunkId: 'Z', score: 1 }], {
    limit: 5,
  });
  assert.deepEqual(
    single.map((f) => f.chunkId),
    ['Z', 'a'],
  );

  // Equal fused score is rare with distinct ranks; construct it with k = 1:
  // zp: ranks (1, 5) → 1/2 + 1/6 = 2/3;  bq: ranks (2, 2) → 1/3 + 1/3 = 2/3. The IDs are
  // chosen so code-unit order alone would put bq first.
  const constructed = fuseRankings(
    [
      { chunkId: 'zp', cosine: 0.9 },
      { chunkId: 'bq', cosine: 0.8 },
      { chunkId: 'f1', cosine: 0.1 },
      { chunkId: 'f2', cosine: 0.1 },
    ],
    [
      { chunkId: 'g1', score: 1 },
      { chunkId: 'bq', score: 0.9 },
      { chunkId: 'g2', score: 0.8 },
      { chunkId: 'g3', score: 0.7 },
      { chunkId: 'zp', score: 0.6 },
    ],
    { k: 1, limit: 3 },
  );
  const p = constructed.find((f) => f.chunkId === 'zp');
  const q = constructed.find((f) => f.chunkId === 'bq');
  assert.ok(p && q);
  assert.equal(p.fusedScore, q.fusedScore);
  // zp has the better single-branch rank (1 vs 2).
  assert.ok(constructed.indexOf(p) < constructed.indexOf(q));
});

await test('duplicates within a branch keep their best rank; inputs and limits are validated', () => {
  const fused = fuseRankings(
    [
      { chunkId: 'a', cosine: 0.9 },
      { chunkId: 'a', cosine: 0.1 },
      { chunkId: 'b', cosine: 0.5 },
    ],
    [],
    { limit: 5 },
  );
  assert.deepEqual(
    fused.map((f) => [f.chunkId, f.vectorRank, f.cosine]),
    [
      ['a', 1, 0.9],
      ['b', 2, 0.5],
    ],
  );
  assert.equal(fuseRankings([], [], { limit: 1 }).length, 0);
  assert.equal(
    fuseRankings(
      Array.from({ length: 80 }, (_, i) => ({ chunkId: `c${i}`, cosine: 1 - i / 100 })),
      [],
      { limit: 50 },
    ).length,
    50,
  );
  for (const options of [{ limit: 0 }, { limit: 51 }, { limit: 2.5 }, { limit: 5, k: 0 }])
    assert.throws(() => fuseRankings([], [], options), RangeError, JSON.stringify(options));
  assert.throws(() => fuseRankings([{ chunkId: 'a', cosine: NaN }], [], { limit: 1 }), RangeError);
});

const candidate = (
  chunkId: string,
  cosine: number | null,
  lexical: number | null,
): FusedCandidate => ({
  chunkId,
  fusedScore: 0,
  vectorRank: cosine === null ? null : 1,
  lexicalRank: lexical === null ? null : 1,
  cosine,
  lexical,
});

await test('an unrelated query whose nearest vector still ranks first is rejected by the gate', () => {
  const gates = freezeGates({ id: 'g1', minCosine: 0.62, minLexical: 0.1, calibration: null });
  // Nearest neighbour of a nonsense query: ranks first, but weak absolute evidence.
  const unrelated = [candidate('nearest', 0.41, null), candidate('second', 0.38, null)];
  assert.deepEqual(applyEvidenceGates(unrelated, gates, 'hybrid'), {
    status: 'no_match',
    results: [],
  });

  const related = [
    candidate('good', 0.7, null),
    candidate('weak', 0.4, null),
    candidate('lex', null, 0.2),
  ];
  const gated = applyEvidenceGates(related, gates, 'hybrid');
  assert.equal(gated.status, 'ok');
  assert.deepEqual(
    gated.results.map((r) => r.chunkId),
    ['good', 'lex'],
  );
});

await test('lexical-only mode uses only the lexical gate; a null gate never passes', () => {
  const gates = freezeGates({ id: 'g1', minCosine: 0.5, minLexical: 0.3, calibration: null });
  const candidates = [
    candidate('v', 0.99, null),
    candidate('l', null, 0.31),
    candidate('both', 0.9, 0.1),
  ];
  assert.deepEqual(
    applyEvidenceGates(candidates, gates, 'lexical_only').results.map((r) => r.chunkId),
    ['l'],
  );
  const vectorOff = freezeGates({ id: 'g2', minCosine: null, minLexical: 0.3, calibration: null });
  assert.deepEqual(
    applyEvidenceGates(candidates, vectorOff, 'hybrid').results.map((r) => r.chunkId),
    ['l'],
  );
  const allOff = freezeGates({ id: 'g3', minCosine: null, minLexical: null, calibration: null });
  assert.equal(applyEvidenceGates(candidates, allOff, 'hybrid').status, 'no_match');
});

await test('gates are validated and frozen', () => {
  const gates = freezeGates({ id: 'g1', minCosine: 0.5, minLexical: null, calibration: null });
  assert.ok(Object.isFrozen(gates));
  assert.throws(() => {
    (gates as { minCosine: number }).minCosine = 0;
  }, TypeError);
  for (const bad of [
    { id: 'g', minCosine: 1.5, minLexical: null, calibration: null },
    { id: 'g', minCosine: null, minLexical: -1, calibration: null },
    { id: 'has space', minCosine: null, minLexical: null, calibration: null },
    { id: 'g', minCosine: null, minLexical: null },
    { id: 'g', minCosine: null, minLexical: null, calibration: null, extra: 1 },
  ])
    assert.throws(() => freezeGates(bad), JSON.stringify(bad));
});

// Synthetic calibration set: relevant chunks have cosine ≥ 0.66 or lexical ≥ 0.25; unrelated
// queries' nearest neighbours peak at 0.52.
const c = (chunkId: string, cosine: number | null, lexical: number | null, relevant = false) => ({
  chunkId,
  cosine,
  lexical,
  relevant,
});
const calibrationSet: CalibrationSet = {
  questions: [
    {
      id: 'a1',
      split: 'calibration',
      answerable: true,
      candidates: [c('r1', 0.81, 0.4, true), c('n1', 0.5, null)],
    },
    {
      id: 'a2',
      split: 'calibration',
      answerable: true,
      candidates: [c('n2', 0.55, null), c('r2', 0.66, null, true)],
    },
    {
      id: 'a3',
      split: 'calibration',
      answerable: true,
      candidates: [c('r3', null, 0.25, true), c('n3', 0.48, null)],
    },
    { id: 'a4', split: 'calibration', answerable: true, candidates: [c('r4', 0.72, null, true)] },
    {
      id: 'u1',
      split: 'calibration',
      answerable: false,
      candidates: [c('x1', 0.52, null), c('x2', 0.5, 0.05)],
    },
    { id: 'u2', split: 'calibration', answerable: false, candidates: [c('x3', 0.47, null)] },
    { id: 'u3', split: 'calibration', answerable: false, candidates: [c('x4', 0.31, 0.12)] },
  ],
};

type Question = CalibrationSet['questions'][number];
// A copy of the calibration set with one question replaced.
const withQuestion = (index: number, patch: (question: Question) => Question): CalibrationSet => ({
  questions: calibrationSet.questions.map((question, i) =>
    i === index ? patch(structuredClone(question)) : question,
  ),
});

await test('calibration finds gates that answer every answerable question and abstain on the rest', () => {
  const { gates, report } = calibrateEvidenceGates(calibrationSet, { id: 'v-1.gates' });

  assert.deepEqual(report, {
    questions: 7,
    answerableHits: 4,
    answerable: 4,
    correctAbstentions: 3,
    unanswerable: 3,
  });
  // Strictest perfect gate: the lowest relevant evidence on each branch.
  assert.equal(gates.minCosine, 0.66);
  assert.equal(gates.minLexical, 0.25);
  assert.equal(gates.calibration?.questions, 7);
  assert.match(gates.calibration?.sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(gates));

  // Deterministic: same input, same gates and hash; any change to the set changes the hash.
  const again = calibrateEvidenceGates(structuredClone(calibrationSet), { id: 'v-1.gates' });
  assert.deepEqual(again.gates, gates);
  const changed = withQuestion(0, (q) => ({
    ...q,
    candidates: q.candidates.map((cand, i) => (i === 1 ? { ...cand, cosine: 0.49 } : cand)),
  }));
  assert.notEqual(
    calibrateEvidenceGates(changed, { id: 'v-1.gates' }).gates.calibration?.sha256,
    gates.calibration?.sha256,
  );
});

await test('only the top K passing candidates count as a hit', () => {
  // The relevant chunk passes the gate but sits second behind a passing irrelevant one.
  const set = {
    questions: [
      {
        id: 'a',
        split: 'calibration',
        answerable: true,
        candidates: [c('n', 0.9, null), c('r', 0.8, null, true)],
      },
      { id: 'u', split: 'calibration', answerable: false, candidates: [c('x', 0.2, null)] },
    ],
  };
  assert.equal(calibrateEvidenceGates(set, { id: 'g', topK: 2 }).report.answerableHits, 1);
  assert.equal(calibrateEvidenceGates(set, { id: 'g', topK: 1 }).report.answerableHits, 0);
});

await test('calibration refuses held-out data and sets that cannot calibrate abstention', () => {
  const heldOut = withQuestion(0, (q) => ({ ...q, split: 'held_out' }));
  assert.throws(() => calibrateEvidenceGates(heldOut, { id: 'g' }), CalibrationInputError);

  const onlyAnswerable = { questions: calibrationSet.questions.filter((q) => q.answerable) };
  assert.throws(() => calibrateEvidenceGates(onlyAnswerable, { id: 'g' }), CalibrationInputError);

  const duplicate = { questions: [...calibrationSet.questions, calibrationSet.questions[0]] };
  assert.throws(() => calibrateEvidenceGates(duplicate, { id: 'g' }), CalibrationInputError);

  const contradictory = withQuestion(4, (q) => ({
    ...q,
    candidates: q.candidates.map((cand, i) => (i === 0 ? { ...cand, relevant: true } : cand)),
  }));
  assert.throws(() => calibrateEvidenceGates(contradictory, { id: 'g' }), CalibrationInputError);

  assert.throws(() => calibrateEvidenceGates({ questions: [] }, { id: 'g' }));
});

await test('calibrated gates applied to held-out questions are used unchanged', () => {
  const { gates } = calibrateEvidenceGates(calibrationSet, { id: 'v-1.gates' });
  const heldOutUnrelated = [candidate('nearest', 0.6, null)];
  assert.equal(applyEvidenceGates(heldOutUnrelated, gates, 'hybrid').status, 'no_match');
  assert.equal(applyEvidenceGates([candidate('hit', 0.7, null)], gates, 'hybrid').status, 'ok');
});
