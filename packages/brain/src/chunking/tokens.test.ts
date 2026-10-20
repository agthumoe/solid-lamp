import assert from 'node:assert/strict';
import test from 'node:test';

import { calibrateTokenEstimator, estimateTokens, utf8Bytes } from './index.ts';

await test('calibration covers the largest observed token/byte ratio with a safety margin', () => {
  const samples = [
    { text: 'plain text', tokens: 3 },
    { text: '漢字', tokens: 5 },
  ];
  const calibrated = calibrateTokenEstimator(samples);

  assert.equal(calibrated.sampleCount, 2);
  assert.equal(calibrated.tokensPerByte, 1);
  for (const sample of samples) assert.ok(calibrated.estimate(sample.text) >= sample.tokens);
  assert.equal(calibrated.estimate(''), 0);
  assert.ok(calibrated.estimate('abcabc') >= calibrated.estimate('abc'));
});

await test('higher observed counts make the estimate more conservative without running a model', () => {
  const low = calibrateTokenEstimator([{ text: 'abc', tokens: 1 }]);
  const high = calibrateTokenEstimator([{ text: 'abc', tokens: 3 }]);

  assert.ok(high.estimate('abcdef') > low.estimate('abcdef'));
  assert.equal(utf8Bytes('😀'), 4);
  assert.equal(estimateTokens('abc'), 1);
});

await test('invalid calibration data cannot produce a usable optimistic estimator', () => {
  for (const samples of [
    [],
    [{ text: '', tokens: 1 }],
    [{ text: 'a', tokens: 0 }],
    [{ text: 'a', tokens: 1.5 }],
    [{ text: 'a', tokens: NaN }],
  ])
    assert.throws(() => calibrateTokenEstimator(samples), RangeError);
  for (const multiplier of [0.9, NaN, Infinity])
    assert.throws(
      () => calibrateTokenEstimator([{ text: 'abc', tokens: 1 }], multiplier),
      RangeError,
    );
});
