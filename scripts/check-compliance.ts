import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { sourceViolations } from './compliance/source-policy.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems: string[] = [];
function sources(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', '.next'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sources(path)
      : /\.[cm]?[jt]sx?$/.test(path) && !path.endsWith('.test.ts')
        ? [path]
        : [];
  });
}
for (const directory of ['scripts', 'apps', 'packages'])
  for (const path of sources(join(root, directory))) {
    for (const violation of sourceViolations(path, readFileSync(path, 'utf8')))
      problems.push(`${path}: ${violation}`);
  }
const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()),
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
});
const pkg = packageSchema.parse(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
    problems.push(`dependency ${name} is not exact-pinned`);
}
for (const command of [
  'lint',
  'typecheck',
  'test',
  'format:check',
  'docs:check',
  'compliance:check',
  'check',
]) {
  if (!pkg.scripts[command]) problems.push(`missing compliance command ${command}`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Applicable source boundaries, frontend size, private bindings and exact pins pass. Manual/future gates: docs/development/compliance.md.',
  );
