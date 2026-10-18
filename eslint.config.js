import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Import boundaries (docs/development/structure.md#import-rules, ARCHITECTURE §3). Flat-config
// rule options do not merge, so each area gets its complete pattern list, in a production and
// a test variant (only tests may use `/testing` doubles).
const TEST_FILES = ['**/*.test.ts', '**/*.test.tsx', '**/test/**/*.ts'];
const boundary = {
  deep: {
    regex: '^@aetherion/[^/]+/src(/|$)|^\\.{1,2}/.*\\bpackages/[^/]+/src/',
    message: 'Import another package through its public entry, never its src files.',
  },
  testing: {
    regex: '^@aetherion/[^/]+/testing$',
    message: 'Test doubles are for tests only.',
  },
  apps: {
    regex: '^@aetherion/(api|inference|worker|web|channels|mcp)(/|$)|^\\.{1,2}/.*\\bapps/',
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
const areas = [
  { files: ['**/*.{ts,tsx}'], extra: [] },
  { files: ['apps/**/*.{ts,tsx}'], extra: [boundary.apps] },
  { files: ['packages/**/*.{ts,tsx}'], extra: [boundary.apps] },
  { files: ['packages/shared/**/*.{ts,tsx}'], extra: [boundary.apps, boundary.internal] },
  { files: ['apps/web/**/*.{ts,tsx}'], extra: [boundary.apps, boundary.server] },
];
const restrict = (patterns) => ({ 'no-restricted-imports': ['error', { patterns }] });
// A nested `files` array matches only when every glob in it matches (area AND test file).
const boundaryConfigs = areas.flatMap(({ files, extra }) => [
  { files, ignores: TEST_FILES, rules: restrict([boundary.deep, boundary.testing, ...extra]) },
  {
    files: files.flatMap((area) => TEST_FILES.map((test) => [area, test])),
    rules: restrict([boundary.deep, ...extra]),
  },
]);

export default tseslint.config(
  { ignores: ['node_modules/**', '.agents/**', '**/dist/**', '**/.next/**'] },
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
    files: ['**/*.tsx', '**/use-*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
