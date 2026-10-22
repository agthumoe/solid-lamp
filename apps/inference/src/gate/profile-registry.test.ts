import assert from 'node:assert/strict';
import test from 'node:test';

import { embeddingProfileId, inferenceError, type InferenceError } from '@aetherion/llm';
import { err, ok, parseModelsConfig, type ModelsConfig, type Result } from '@aetherion/shared';

import { call, digestOf, fakeAdapter, serviceWith } from '../../test/support/fakes.ts';
import { createProfileRegistry, type InstalledArtifacts } from './profile-registry.ts';

const config = (embed = 'qwen3-embedding:0.6b'): ModelsConfig => {
  const parsed = parseModelsConfig(`
ollama: { base_url: 'http://127.0.0.1:11434' }
roles:
  chat: { model: 'qwen3.5:9b', num_ctx: 16384, residency: resident }
  router: { model: 'qwen3.5:9b', num_ctx: 16384, residency: shared }
  coder: { model: 'qwen3.5:9b', num_ctx: 16384, residency: shared }
  embed: { model: '${embed}', num_ctx: 8192, residency: resident, dimensions: 3, query_prefix: 'q: ' }
fallbacks:
  embed: [nomic-embed-text]
fallback_embedding_options:
  nomic-embed-text: { dimensions: 2, num_ctx: 2048, query_prefix: 'search_query: ', document_prefix: 'search_document: ' }
`);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
};

const installed =
  (entries: Record<string, string>): InstalledArtifacts =>
  () =>
    Promise.resolve(ok(new Map(Object.entries(entries))));
const signal = () => AbortSignal.timeout(1_000);
const ALL = {
  'qwen3-embedding:0.6b': digestOf('qwen3-embedding:0.6b'),
  'nomic-embed-text:latest': digestOf('nomic-embed-text'),
};

await test('only configured models that are installed become profiles; the role is the default', async () => {
  const registry = createProfileRegistry({ config: () => config(), installed: installed(ALL) });
  const listing = await registry.list(signal());
  assert.ok(listing.ok);
  assert.deepEqual(
    listing.value.profiles.map((p) => [p.model, p.dimensions, p.queryPrefix, p.documentPrefix]),
    [
      ['qwen3-embedding:0.6b', 3, 'q: ', ''],
      ['nomic-embed-text', 2, 'search_query: ', 'search_document: '],
    ],
  );
  assert.equal(listing.value.defaultProfileId, listing.value.profiles[0]?.id);

  // An installed model that is not configured never becomes a profile; a configured model that
  // is not installed is not approved.
  const partial = createProfileRegistry({
    config: () => config(),
    installed: installed({
      'nomic-embed-text:latest': ALL['nomic-embed-text:latest'],
      'evil:latest': 'f'.repeat(64),
    }),
  });
  const only = await partial.list(signal());
  assert.ok(only.ok);
  assert.deepEqual(
    only.value.profiles.map((p) => p.model),
    ['nomic-embed-text'],
  );
  assert.equal(only.value.defaultProfileId, null);
  const missing = await partial.resolve(undefined, signal());
  assert.deepEqual(missing.ok ? null : missing.error.code, 'PROFILE_UNAVAILABLE');
});

await test('profile IDs are deterministic and change with the artifact, context or prefixes', () => {
  const identity = {
    model: 'm',
    dimensions: 3,
    numCtx: 8192,
    queryPrefix: 'q: ',
    documentPrefix: '',
  };
  const id = embeddingProfileId(identity, 'a'.repeat(64));
  assert.match(id, /^ep-[0-9a-f]{24}$/);
  assert.equal(embeddingProfileId({ ...identity }, 'a'.repeat(64)), id);
  for (const changed of [
    embeddingProfileId(identity, 'b'.repeat(64)),
    embeddingProfileId({ ...identity, numCtx: 4096 }, 'a'.repeat(64)),
    embeddingProfileId({ ...identity, queryPrefix: '' }, 'a'.repeat(64)),
    embeddingProfileId({ ...identity, documentPrefix: 'd: ' }, 'a'.repeat(64)),
    embeddingProfileId({ ...identity, dimensions: 4 }, 'a'.repeat(64)),
  ])
    assert.notEqual(changed, id);
});

await test('resolve finds pinned profiles; verify detects a replaced artifact', async () => {
  let artifacts: Record<string, string> = { ...ALL };
  const registry = createProfileRegistry({
    config: () => config(),
    installed: () => Promise.resolve(ok(new Map(Object.entries(artifacts)))),
  });
  const listing = await registry.list(signal());
  assert.ok(listing.ok);
  const fallback = listing.value.profiles[1];
  assert.ok(fallback);
  const pinned = await registry.resolve(fallback.id, signal());
  assert.deepEqual(pinned.ok && pinned.value, fallback);
  const unknown = await registry.resolve('ep-ffffffffffffffffffffffff', signal());
  assert.equal(unknown.ok ? null : unknown.error.code, 'PROFILE_UNAVAILABLE');

  assert.ok((await registry.verify(fallback, signal())).ok);
  artifacts = { ...ALL, 'nomic-embed-text:latest': 'c'.repeat(64) }; // re-pulled
  const replaced = await registry.verify(fallback, signal());
  assert.equal(replaced.ok ? null : replaced.error.code, 'PROFILE_UNAVAILABLE');
  // The old ID no longer resolves; the new artifact is a new profile.
  assert.equal((await registry.resolve(fallback.id, signal())).ok, false);
});

await test('an unreachable Ollama surfaces its own error, not a profile error', async () => {
  const down: InstalledArtifacts = () =>
    Promise.resolve(
      err(inferenceError('INFERENCE_UNAVAILABLE', 'down')) as Result<never, InferenceError>,
    );
  const registry = createProfileRegistry({ config: () => config(), installed: down });
  const result = await registry.resolve(undefined, signal());
  assert.equal(result.ok ? null : result.error.code, 'INFERENCE_UNAVAILABLE');
});

await test('service: a pinned profile embeds with that profile even after the role changes', async () => {
  let current = config();
  const fake = fakeAdapter({
    embed: (texts) =>
      ok({ vectors: texts.map(() => [0.5, 0.5]), tokensIn: 1, totalMs: 1, loadMs: 0 }),
  });
  const { service } = serviceWith(fake.adapter, {
    config: () => current,
    installed: installed(ALL),
  });
  const listing = await service.embedProfiles(signal());
  assert.ok(listing.ok);
  const nomic = listing.value.profiles.find((p) => p.model === 'nomic-embed-text');
  assert.ok(nomic);
  current = config('nomic-embed-text'); // the role moves; the pinned profile must not

  const result = await service.embed(
    { texts: ['x'], kind: 'document', profileId: nomic.id },
    call('background'),
  );
  assert.ok(result.ok, result.ok ? '' : result.error.message);
  assert.deepEqual(result.value.profile, nomic);
  assert.equal(fake.embeds[0]?.snapshot.model, 'nomic-embed-text');
  assert.equal(fake.embeds[0]?.snapshot.documentPrefix, 'search_document: ');
});

await test('service: an artifact replaced while queued fails explicitly and never embeds', async () => {
  let artifacts: Record<string, string> = { ...ALL };
  const fake = fakeAdapter();
  const { service, gate } = serviceWith(fake.adapter, {
    config: () => config(),
    installed: () => Promise.resolve(ok(new Map(Object.entries(artifacts)))),
  });
  let release: () => void = () => undefined;
  const hold = gate.run(
    () =>
      new Promise<Result<string, InferenceError>>(
        (resolve) => (release = () => resolve(ok('held'))),
      ),
    call(),
  );
  const pending = service.embed({ texts: ['x'], kind: 'query' }, call('background'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  artifacts = { ...ALL, 'qwen3-embedding:0.6b': 'd'.repeat(64) };
  release();
  await hold;
  const result = await pending;
  assert.equal(result.ok ? null : result.error.code, 'PROFILE_UNAVAILABLE');
  assert.equal(fake.embeds.length, 0);

  const unknown = await service.embed(
    { texts: ['x'], kind: 'query', profileId: 'ep-ffffffffffffffffffffffff' },
    call(),
  );
  assert.equal(unknown.ok ? null : unknown.error.code, 'PROFILE_UNAVAILABLE');
  assert.equal(fake.embeds.length, 0);
});

await test('service: a stalled profile resolution still honours the call deadline', async () => {
  let release: () => void = () => undefined;
  const stalled: InstalledArtifacts = () =>
    new Promise((resolve) => (release = () => resolve(ok(new Map(Object.entries(ALL))))));
  const fake = fakeAdapter();
  const { service } = serviceWith(fake.adapter, { config: () => config(), installed: stalled });
  const started = Date.now();
  const result = await service.embed(
    { texts: ['x'], kind: 'query' },
    {
      priority: 'interactive',
      signal: new AbortController().signal,
      deadline: new Date(Date.now() + 30),
    },
  );
  release();
  assert.equal(result.ok ? null : result.error.code, 'DEADLINE_EXPIRED');
  assert.ok(Date.now() - started < 1_000, 'returned at the deadline, not when Ollama answered');
  assert.equal(fake.embeds.length, 0);

  const expired = await service.embed(
    { texts: ['x'], kind: 'query' },
    {
      priority: 'interactive',
      signal: new AbortController().signal,
      deadline: new Date(Date.now() - 1),
    },
  );
  assert.equal(expired.ok ? null : expired.error.code, 'DEADLINE_EXPIRED');
});
