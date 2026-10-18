import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { parseCatalog, validateBindings, type ModelCatalog } from './catalog-config.ts';
import { parseModelsConfig, type ModelsConfig } from './models-config.ts';

const DIGEST = 'a'.repeat(64);

const catalogText = (models: string) => `revision: 1\nmodels:\n${models}`;

const general = `
  - id: general
    tag: qwen3.5:9b
    digest: ${DIGEST}
    upstream: ollama.com/library/qwen3.5
    state: enabled
    retained: true
    capabilities: [text, vision, tools]
    roles: [chat, router, coder, vision]
    evidence:
      - { kind: gpu_context, status: passed, scope: [chat, router, coder, vision], ref: docs/HARDWARE.md }
  - id: embed
    tag: qwen3-embedding:0.6b
    digest: ${'b'.repeat(64)}
    upstream: ollama.com/library/qwen3-embedding
    state: enabled
    retained: true
    capabilities: [embedding]
    dimensions: 4
    roles: [embed]
    evidence:
      - { kind: gpu_context, status: passed, scope: [embed], ref: docs/HARDWARE.md }
  - id: alt
    tag: qwen3:8b
    digest: ${'c'.repeat(64)}
    upstream: ollama.com/library/qwen3
    state: enabled
    retained: true
    capabilities: [text]
    roles: [chat]
    evidence:
      - { kind: gpu_context, status: passed, scope: [chat], ref: docs/HARDWARE.md }
`;

const modelsText = (extra = '') => `
ollama: { base_url: 'http://127.0.0.1:11434' }
roles:
  chat: { model: 'qwen3.5:9b', num_ctx: 16384, residency: resident }
  router: { model: 'qwen3.5:9b', num_ctx: 16384, residency: shared }
  coder: { model: 'qwen3.5:9b', num_ctx: 16384, residency: shared }
  embed: { model: 'qwen3-embedding:0.6b', num_ctx: 8192, residency: resident, dimensions: 4 }
${extra}`;

const catalog = (models = general): ModelCatalog => {
  const parsed = parseCatalog(catalogText(models));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
};

const models = (extra = ''): ModelsConfig => {
  const parsed = parseModelsConfig(modelsText(extra));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
};

const bindingError = (config: ModelsConfig, records: ModelCatalog) => {
  const result = validateBindings(config, records);
  return result.ok ? undefined : result.error.message;
};

await test('valid bindings and fallbacks pass', () => {
  assert.equal(bindingError(models('fallbacks: { chat: [qwen3:8b] }'), catalog()), undefined);
});

await test('schema rejects duplicates, unknown keys and contradictory records', () => {
  const cases: [string, RegExp][] = [
    [
      general + general.split('  - id: embed')[0]?.replace('id: general', 'id: general'),
      /duplicate id/,
    ],
    [
      general.replace('id: alt', 'id: alt2').replace('tag: qwen3:8b', 'tag: qwen3.5:9b'),
      /duplicate tag/,
    ],
    [
      general.replace(
        'state: enabled\n    retained: true\n    capabilities: [text]\n',
        'state: enabled\n    retained: true\n    surprise: 1\n    capabilities: [text]\n',
      ),
      /invalid catalog/,
    ],
    [general.replace(`digest: ${'c'.repeat(64)}`, 'digest: null'), /need a tag and digest/],
    [
      general.replace(
        'state: enabled\n    retained: true\n    capabilities: [text]\n',
        'state: disabled\n    retained: true\n    capabilities: [text]\n',
      ),
      /need a reason/,
    ],
    [general.replace('    dimensions: 4\n', ''), /declare dimensions/],
    [general.replace('retained: true', 'retained: false'), /invalid catalog/],
    [general.replace('ref: docs/HARDWARE.md }', 'ref: "the owner said so" }'), /invalid catalog/],
  ];
  for (const [text, message] of cases) {
    const parsed = parseCatalog(catalogText(text));

    assert.equal(parsed.ok, false, `expected failure for ${String(message)}`);
    assert.match(parsed.ok ? '' : parsed.error.message, message);
  }
  assert.match(
    (() => {
      const parsed = parseCatalog('models: [');
      return parsed.ok ? '' : parsed.error.message;
    })(),
    /not valid YAML/,
  );
});

await test('a bound model must be an enabled record accepted for the role', () => {
  const unlisted = parseModelsConfig(
    modelsText().replace("chat: { model: 'qwen3.5:9b'", "chat: { model: 'mystery:1b'"),
  );
  assert.ok(unlisted.ok);

  assert.match(
    bindingError(unlisted.value, catalog()) ?? '',
    /roles\.chat \(mystery:1b\): not in the catalog/,
  );
  assert.match(
    bindingError(
      models(),
      catalog(general.replace('roles: [chat, router, coder, vision]', 'roles: [chat, vision]')),
    ) ?? '',
    /roles\.router \(qwen3\.5:9b\): general is not accepted for router/,
  );
  assert.match(
    bindingError(
      models(),
      catalog(
        general.replace(
          'state: enabled\n    retained: true\n    capabilities: [text, vision, tools]',
          'state: evaluating\n    retained: true\n    capabilities: [text, vision, tools]',
        ),
      ),
    ) ?? '',
    /general is evaluating/,
  );
});

await test('capability, evidence and dimensions are checked per role', () => {
  const vision = models("  vision: { model: 'qwen3:8b', num_ctx: 8192, residency: shared }");
  const visionCatalog = catalog(general.replace('roles: [chat]\n', 'roles: [chat, vision]\n'));
  assert.match(bindingError(vision, visionCatalog) ?? '', /alt lacks vision capability/);

  const failed = catalog(
    general.replace(
      '- { kind: gpu_context, status: passed, scope: [chat, router, coder, vision], ref: docs/HARDWARE.md }',
      '- { kind: gpu_context, status: passed, scope: [chat, router, coder, vision], ref: docs/HARDWARE.md }\n      - { kind: tool_calling, status: failed, scope: [coder], ref: docs/HARDWARE.md }',
    ),
  );
  assert.match(bindingError(models(), failed) ?? '', /failed or revoked evidence for coder/);

  const unproven = catalog(
    general.replace('scope: [chat, router, coder, vision]', 'scope: [chat, router, vision]'),
  );
  assert.match(bindingError(models(), unproven) ?? '', /no passed gpu_context evidence for coder/);

  assert.match(
    bindingError(models(), catalog(general.replace('dimensions: 4', 'dimensions: 8'))) ?? '',
    /roles\.embed: dimensions differ/,
  );
});

await test('fallbacks must be distinct, enabled and accepted for the role', () => {
  assert.match(
    bindingError(models('fallbacks: { chat: [qwen3.5:9b] }'), catalog()) ?? '',
    /cannot be its own fallback/,
  );
  assert.match(
    bindingError(models('fallbacks: { router: [qwen3:8b] }'), catalog()) ?? '',
    /alt is not accepted for router/,
  );
  assert.match(
    bindingError(models('fallbacks: { chat: [gemma4:12b] }'), catalog()) ?? '',
    /not in the catalog/,
  );
});

await test('the committed catalog keeps the whole retained portfolio and validates models.yaml', () => {
  const committed = parseCatalog(readFileSync('config/catalog.yaml', 'utf8'));
  const config = parseModelsConfig(readFileSync('config/models.yaml', 'utf8'));
  assert.ok(committed.ok && config.ok);

  const tags = new Set(committed.value.models.map((record) => record.tag));
  for (const tag of [
    'qwen3.5:9b',
    'qwen3.5:4b',
    'qwen2.5-coder:14b',
    'qwen3-embedding:0.6b',
    'qwen3:8b',
    'gemma4:12b',
    'nomic-embed-text',
    'deepseek-r1:14b',
    'deepseek-r1:7b',
    'qwen2.5:7b',
    'qwen3.6:35b-a3b',
  ])
    assert.ok(tags.has(tag), `retained model ${tag} missing from catalog`);
  for (const id of ['saul-legal', 'fin-r1', 'cpa-qwen'])
    assert.ok(
      committed.value.models.some((record) => record.id === id && record.state === 'candidate'),
    );
  for (const record of committed.value.models)
    for (const entry of record.evidence)
      if (!entry.ref.startsWith('https://'))
        assert.ok(existsSync(entry.ref), `${entry.ref} missing`);
  assert.deepEqual(validateBindings(config.value, committed.value), { ok: true, value: undefined });
});
