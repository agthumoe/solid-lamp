import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import {
  BRAIN_CITATION_DISPLAY_MAX_CHARS,
  type BrainSearchQuery,
} from '@aetherion/shared/contracts';

import { createBrainApiClient, MAX_RESPONSE_BYTES, SERVICE_KEY_HEADER } from './api-client.ts';
import { citation, HASH, searchOk, startFakeApi, statsBody } from './fake-api.ts';

const KEY = 'k'.repeat(40);
const signal = () => AbortSignal.timeout(2_000);
const query: BrainSearchQuery = {
  q: 'plan',
  limit: 8,
  source: ['vault'],
  tag: ['work', 'q4'],
  tagMode: 'any',
  mode: 'hybrid',
};

await test('search sends the service key and repeated filters, and returns the validated body', async () => {
  const api = await startFakeApi(() => ({ body: searchOk() }));
  try {
    const client = createBrainApiClient({ baseUrl: api.url, serviceKey: KEY });
    const result = await client.search(query, signal());

    assert.ok(result.ok);
    assert.equal(result.value.status, 'ok');
    const [request] = api.requests;
    assert.equal(request?.path, '/api/v1/brain/search');
    assert.equal(request?.headers[SERVICE_KEY_HEADER], KEY);
    assert.deepEqual(request?.query.getAll('tag'), ['work', 'q4']);
    assert.equal(request?.query.get('q'), 'plan');
    assert.equal(request?.query.has('pathPrefix'), false);
  } finally {
    await api.close();
  }
});

await test('error envelopes map to their code; unknown codes and non-JSON errors are UNAVAILABLE', async () => {
  const cases: [Parameters<typeof startFakeApi>[0], string][] = [
    [
      () => ({
        status: 401,
        body: { error: { code: 'UNAUTHENTICATED', message: 'x', requestId: 'r' } },
      }),
      'UNAUTHENTICATED',
    ],
    [
      () => ({ status: 403, body: { error: { code: 'FORBIDDEN', message: 'x', requestId: 'r' } } }),
      'FORBIDDEN',
    ],
    [
      () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' } } }),
      'NOT_FOUND',
    ],
    [
      () => ({
        status: 429,
        body: { error: { code: 'RATE_LIMITED', message: 'x', requestId: 'r' } },
      }),
      'RATE_LIMITED',
    ],
    [
      () => ({
        status: 503,
        body: { error: { code: 'UNAVAILABLE', message: 'x', requestId: 'r' } },
      }),
      'UNAVAILABLE',
    ],
    [
      () => ({
        status: 409,
        body: { error: { code: 'APPROVAL_EXPIRED', message: 'x', requestId: 'r' } },
      }),
      'UNAVAILABLE',
    ],
    [() => ({ status: 502, raw: '<html>bad gateway</html>' }), 'UNAVAILABLE'],
  ];
  for (const [answer, code] of cases) {
    const api = await startFakeApi(answer);
    try {
      const result = await createBrainApiClient({ baseUrl: api.url, serviceKey: KEY }).stats(
        signal(),
      );
      assert.deepEqual(result, { ok: false, code }, code);
    } finally {
      await api.close();
    }
  }
});

await test('a 200 that does not match the contract is BAD_RESPONSE', async () => {
  for (const scripted of [
    { body: { ...statsBody, model: 'qwen3-embedding:8b' } },
    { body: { ...searchOk(), results: [] } },
    { body: { ...searchOk('x'.repeat(5_000)) } },
    { raw: 'not json' },
  ]) {
    const api = await startFakeApi(() => scripted);
    try {
      const client = createBrainApiClient({ baseUrl: api.url, serviceKey: KEY });
      const result =
        'model' in (scripted.body ?? {})
          ? await client.stats(signal())
          : await client.search(query, signal());
      assert.deepEqual(
        result,
        { ok: false, code: 'BAD_RESPONSE' },
        JSON.stringify(scripted).slice(0, 60),
      );
    } finally {
      await api.close();
    }
  }
});

await test('a body over the cap is refused even when it would otherwise be valid', async () => {
  // Valid stats JSON followed by insignificant whitespace: only the size cap rejects it.
  const api = await startFakeApi(() => ({
    raw: JSON.stringify(statsBody) + ' '.repeat(MAX_RESPONSE_BYTES + 1),
  }));
  try {
    const result = await createBrainApiClient({ baseUrl: api.url, serviceKey: KEY }).stats(
      signal(),
    );
    assert.deepEqual(result, { ok: false, code: 'BAD_RESPONSE' });
  } finally {
    await api.close();
  }
});

await test('a slow api hits the deadline; an unreachable one is UNAVAILABLE', async () => {
  const api = await startFakeApi(() => ({ body: statsBody, delayMs: 500 }));
  try {
    const result = await createBrainApiClient({ baseUrl: api.url, serviceKey: KEY }).stats(
      AbortSignal.timeout(50),
    );
    assert.deepEqual(result, { ok: false, code: 'DEADLINE_EXPIRED' });
  } finally {
    await api.close();
  }
  const closed = createBrainApiClient({ baseUrl: 'http://127.0.0.1:9', serviceKey: KEY });
  assert.deepEqual(await closed.stats(signal()), { ok: false, code: 'UNAVAILABLE' });
});

await test('redirects are not followed, so the key never reaches another server', async () => {
  const other = createServer((req, res) => {
    seen.push(req.headers[SERVICE_KEY_HEADER]);
    res.end(JSON.stringify(statsBody));
  });
  const seen: unknown[] = [];
  await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
  const target = `http://127.0.0.1:${(other.address() as AddressInfo).port}/api/v1/brain/stats`;
  const api = await startFakeApi(() => ({ status: 307, headers: { location: target }, raw: '' }));
  try {
    const result = await createBrainApiClient({ baseUrl: api.url, serviceKey: KEY }).stats(
      signal(),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(seen, []);
  } finally {
    await api.close();
    other.closeAllConnections();
    await new Promise((resolve) => other.close(resolve));
  }
});

await test('note passes the citation identity and bound', async () => {
  const api = await startFakeApi(() => ({ body: { status: 'stale', reason: 'revision' } }));
  try {
    const result = await createBrainApiClient({ baseUrl: api.url, serviceKey: KEY }).note(
      {
        sourceId: 'vault',
        documentId: 'doc-1',
        chunkId: 'chunk-1',
        versionId: 'v-1',
        revision: 2,
        contentHash: HASH,
        pathSha256: 'd'.repeat(64),
        maxChars: 500,
      },
      signal(),
    );
    assert.deepEqual(result, { ok: true, value: { status: 'stale', reason: 'revision' } });
    assert.equal(api.requests[0]?.query.get('maxChars'), '500');
    assert.equal(api.requests[0]?.query.get('revision'), '2');
  } finally {
    await api.close();
  }
});

await test('the largest contract-valid search response fits under the cap and is accepted', async () => {
  const wide = '界';
  const heading = wide.repeat(500);
  const result = {
    ...searchOk().results[0],
    documentPath: wide.repeat(2048),
    title: wide.repeat(500),
    headingPath: Array(6).fill(heading),
    snippet: wide.repeat(1_200),
    citation: {
      ...citation(),
      display: wide.repeat(BRAIN_CITATION_DISPLAY_MAX_CHARS),
      path: wide.repeat(2048),
      headingPath: Array(6).fill(heading),
    },
  };
  const body = { ...searchOk(), results: Array(50).fill(result) };
  const size = Buffer.byteLength(JSON.stringify(body));
  assert.ok(size > 2 * 1024 * 1024 && size < MAX_RESPONSE_BYTES, String(size));
  const api = await startFakeApi(() => ({ body }));
  try {
    const response = await createBrainApiClient({ baseUrl: api.url, serviceKey: KEY }).search(
      query,
      signal(),
    );
    assert.ok(response.ok, response.ok ? '' : response.code);
  } finally {
    await api.close();
  }
});
