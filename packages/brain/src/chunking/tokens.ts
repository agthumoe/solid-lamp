import type { TokenEstimator } from './types.ts';

const encoder = new TextEncoder();
export const utf8Bytes = (text: string): number => encoder.encode(text).length;

// A heuristic, not a model tokenizer. The independent byte bound guards the context window.
export const estimateTokens: TokenEstimator = (text) => Math.ceil(utf8Bytes(text) / 3);

export type TokenSample = { readonly text: string; readonly tokens: number };

export const calibrateTokenEstimator = (
  samples: readonly TokenSample[],
  safetyMultiplier = 1.2,
): {
  readonly estimate: TokenEstimator;
  readonly sampleCount: number;
  readonly tokensPerByte: number;
} => {
  if (samples.length === 0 || !Number.isFinite(safetyMultiplier) || safetyMultiplier < 1)
    throw new RangeError('calibration needs samples and a safety multiplier >= 1');
  const ratios = samples.map(({ text, tokens }) => {
    const bytes = utf8Bytes(text);
    if (bytes === 0 || !Number.isSafeInteger(tokens) || tokens <= 0)
      throw new RangeError('calibration samples need nonempty text and positive integer counts');
    return tokens / bytes;
  });
  const tokensPerByte =
    ratios.reduce((maximum, ratio) => Math.max(maximum, ratio), 0) * safetyMultiplier;
  if (!Number.isFinite(tokensPerByte)) throw new RangeError('invalid calibration ratio');
  return {
    estimate: (text) => Math.ceil(utf8Bytes(text) * tokensPerByte),
    sampleCount: samples.length,
    tokensPerByte,
  };
};
