import { dirname, relative, resolve } from 'node:path';

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Import boundaries (docs/development/structure.md#import-rules, ARCHITECTURE §3). Flat-config
// rule options do not merge, so each area gets its complete pattern list, in a production and
// a test variant (only tests may use `/testing` doubles).
const TEST_FILES = ['**/*.test.ts', '**/*.test.tsx', '**/test/**/*.ts'];
const boundary = {
  deep: {
    regex: '^@aetherion/[^/]+/src(/|$)',
    message: 'Import another package through its public entry, never its src files.',
  },
  testing: {
    regex: '^@aetherion/[^/]+/testing$',
    message: 'Test doubles are for tests only.',
  },
  apps: {
    regex: '^@aetherion/(api|inference|worker|web|channels|mcp)(/|$)',
    message: 'Apps are entry points: packages and other apps never import them.',
  },
  internal: {
    regex: '^@aetherion/',
    message: 'packages/shared depends on nothing internal.',
  },
  server: {
    regex: '^@aetherion/(db|llm|agents|brain|evals)(/|$)|^@aetherion/shared$',
    message: 'apps/web may only import @aetherion/shared/contracts.',
  },
};
// Relative paths are resolved against the importing file: one that lands in another
// apps/* or packages/* workspace (sibling `../../llm/src/...` included) must use that
// package's name, so the name-based rules above apply to it.
const workspaceOf = (path) => {
  const match = relative(import.meta.dirname, path)
    .split('\\')
    .join('/')
    .match(/^(apps|packages)\/([^/]+)\//);
  return match ? `${match[1]}/${match[2]}` : 'root';
};
const crossWorkspaceRelative = {
  meta: {
    type: 'problem',
    messages: {
      cross: 'Relative import leaves {{from}} for {{to}}: import the package by name instead.',
    },
    schema: [],
  },
  create(context) {
    const from = workspaceOf(context.filename);
    const check = (source) => {
      if (source?.type !== 'Literal' || typeof source.value !== 'string') return;
      if (!source.value.startsWith('.')) return;
      const to = workspaceOf(resolve(dirname(context.filename), source.value));
      if (to !== from) context.report({ node: source, messageId: 'cross', data: { from, to } });
    };
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};

// `no-restricted-imports` ignores `import()`, so the same per-area patterns are applied to
// dynamic imports with a static specifier (string or expression-free template literal).
const staticSpecifier = (source) => {
  if (source?.type === 'Literal' && typeof source.value === 'string') return source.value;
  if (source?.type === 'TemplateLiteral' && source.expressions.length === 0)
    return source.quasis[0]?.value.cooked ?? undefined;
  return undefined;
};
const restrictedDynamicImport = {
  meta: {
    type: 'problem',
    messages: { restricted: "'{{specifier}}' is restricted: {{message}}" },
    schema: [
      {
        type: 'object',
        properties: {
          patterns: {
            type: 'array',
            items: {
              type: 'object',
              properties: { regex: { type: 'string' }, message: { type: 'string' } },
              required: ['regex', 'message'],
            },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const patterns = (context.options[0]?.patterns ?? []).map(({ regex, message }) => ({
      test: new RegExp(regex),
      message,
    }));
    return {
      ImportExpression(node) {
        const specifier = staticSpecifier(node.source);
        if (specifier === undefined) return;
        const hit = patterns.find(({ test }) => test.test(specifier));
        if (hit)
          context.report({
            node: node.source,
            messageId: 'restricted',
            data: { specifier, message: hit.message },
          });
      },
    };
  },
};
const aetherionPlugin = {
  rules: {
    'cross-workspace-relative': crossWorkspaceRelative,
    'restricted-dynamic-import': restrictedDynamicImport,
  },
};

const areas = [
  { files: ['**/*.{ts,tsx}'], extra: [] },
  { files: ['apps/**/*.{ts,tsx}'], extra: [boundary.apps] },
  { files: ['packages/**/*.{ts,tsx}'], extra: [boundary.apps] },
  { files: ['packages/shared/**/*.{ts,tsx}'], extra: [boundary.apps, boundary.internal] },
  { files: ['apps/web/**/*.{ts,tsx}'], extra: [boundary.apps, boundary.server] },
];
const restrict = (patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
  'aetherion/restricted-dynamic-import': ['error', { patterns }],
});
// A nested `files` array matches only when every glob in it matches (area AND test file).
const boundaryConfigs = areas.flatMap(({ files, extra }) => [
  { files, ignores: TEST_FILES, rules: restrict([boundary.deep, boundary.testing, ...extra]) },
  {
    files: files.flatMap((area) => TEST_FILES.map((test) => [area, test])),
    rules: restrict([boundary.deep, ...extra]),
  },
]);

export default tseslint.config(
  // `.claude/` holds other agents' git worktrees; they are separate checkouts, not this one.
  { ignores: ['node_modules/**', '.agents/**', '.claude/**', '**/dist/**', '**/.next/**'] },
  { files: ['**/*.{ts,tsx}'], plugins: { aetherion: aetherionPlugin } },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: {
          // Virtual files linted by scripts/compliance tests; they never exist on disk.
          allowDefaultProject: [
            'apps/web/src/policy-sample.tsx',
            'apps/web/src/policy-sample.ts',
            'apps/api/src/policy-sample.ts',
            'packages/shared/src/policy-sample.ts',
            'packages/llm/src/policy-sample.ts',
            'packages/llm/src/policy-sample.test.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  ...boundaryConfigs,
  {
    files: ['**/*.{ts,tsx}'],
    rules: { 'aetherion/cross-workspace-relative': 'error' },
  },
  {
    files: ['**/*.tsx', '**/use-*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
