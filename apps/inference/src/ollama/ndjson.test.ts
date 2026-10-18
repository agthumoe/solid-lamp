import assert from 'node:assert/strict';
import test from 'node:test';

import { NdjsonError, readNdjson } from './ndjson.ts';

const streamOf = (parts: readonly string[]) => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
};

const collect = async (parts: readonly string[]) => {
  const out: unknown[] = [];
  for await (const value of readNdjson(streamOf(parts))) out.push(value);
  return out;
};

await test('lines split across chunks, blank lines and a final unterminated line parse', async () => {
  assert.deepEqual(await collect(['{"a":', '1}\n\n{"b"', ':"é"}\n{"c":3}']), [
    { a: 1 },
    { b: 'é' },
    { c: 3 },
  ]);
});

await test('a multi-byte character split across chunks decodes intact', async () => {
  const bytes = new TextEncoder().encode('{"t":"ü"}\n');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 7));
      controller.enqueue(bytes.slice(7));
      controller.close();
    },
  });
  const out: unknown[] = [];
  for await (const value of readNdjson(body)) out.push(value);
  assert.deepEqual(out, [{ t: 'ü' }]);
});

await test('malformed JSON and oversized lines throw NdjsonError', async () => {
  await assert.rejects(collect(['{"a":1}\n{oops}\n']), NdjsonError);
  await assert.rejects(collect(['"', 'x'.repeat(1_048_577)]), NdjsonError);
  // A complete oversized line must fail whether it arrives in one chunk or many.
  const oversized = `"${'x'.repeat(1_048_577)}"\n`;
  await assert.rejects(collect([oversized]), /size limit/);
  const parts = oversized.match(/[\s\S]{1,65536}/g) ?? [];
  await assert.rejects(collect(parts), /size limit/);
  await assert.rejects(collect([oversized.trimEnd()]), /size limit/);
});
