import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { pinViolations } from './compliance/package-policy.ts';
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
  scripts: z.record(z.string(), z.string()).default({}),
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
});
const readManifest = (path: string) =>
  packageSchema.parse(JSON.parse(readFileSync(join(root, path), 'utf8')));
const pkg = readManifest('package.json');
const workspaceManifests = ['apps', 'packages'].flatMap((directory) =>
  existsSync(join(root, directory))
    ? readdirSync(join(root, directory))
        .map((name) => `${directory}/${name}/package.json`)
        .filter((path) => existsSync(join(root, path)))
    : [],
);
for (const path of ['package.json', ...workspaceManifests]) {
  const manifest = path === 'package.json' ? pkg : readManifest(path);
  problems.push(...pinViolations(path, { ...manifest.dependencies, ...manifest.devDependencies }));
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
