// Issue #1: verify authored Markdown links and pinned project-skill integrity.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { requiredAt } from './lib/required-at.ts';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems: string[] = [];
function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
const authored = [
  ...walk(join(root, 'docs')).filter((path) => extname(path) === '.md'),
  ...['AGENTS.md', 'CLAUDE.md', 'README.md', 'CONTRIBUTING.md', 'THIRD_PARTY_NOTICES.md'].map(
    (path) => join(root, path),
  ),
];
for (const file of authored) {
  const markdown = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = requiredAt(match, 1).trim().replace(/^<|>$/g, '').split('#')[0];
    if (!link || /^(https?:|mailto:|app:)/.test(link)) continue;
    const target = resolve(dirname(file), decodeURIComponent(link));
    if (!existsSync(target)) problems.push(`${relative(root, file)}: broken link ${link}`);
  }
}
const lock = z
  .object({
    skills: z.array(
      z.object({
        name: z.string(),
        directory: z.string(),
        commit: z.string(),
        files: z.record(z.string(), z.string()),
      }),
    ),
  })
  .parse(JSON.parse(readFileSync(join(root, 'docs/development/skills-lock.json'), 'utf8')));
for (const skill of lock.skills) {
  if (!/^[a-f0-9]{40}$/.test(skill.commit)) problems.push(`${skill.name}: unpinned commit`);
  const base = resolve(root, skill.directory);
  const actual = walk(base)
    .map((path) => relative(base, path))
    .sort();
  const expected = Object.keys(skill.files).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    problems.push(`${skill.name}: file inventory differs from lock`);
  for (const [path, hash] of Object.entries(skill.files)) {
    const file = join(base, path);
    if (!existsSync(file)) {
      problems.push(`${skill.name}: missing ${path}`);
      continue;
    }
    if (createHash('sha256').update(readFileSync(file)).digest('hex') !== hash)
      problems.push(`${skill.name}: changed ${path}`);
  }
  const entry = readFileSync(join(base, 'SKILL.md'), 'utf8');
  const frontmatter = entry.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const metadata = z
    .object({ name: z.string(), license: z.string() })
    .parse(frontmatter ? parse(requiredAt(frontmatter, 1)) : {});
  if (metadata.name !== skill.name || metadata.license !== 'MIT')
    problems.push(`${skill.name}: unexpected skill name/license`);
}
const pkg = z
  .object({ scripts: z.record(z.string(), z.string()) })
  .parse(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
for (const script of Object.keys(pkg.scripts)) {
  if (!makefile.includes(`${script.replaceAll(':', '\\:')}:`))
    problems.push(`Missing Makefile mirror: ${script}`);
}
// pnpm built-ins win over package.json scripts of the same name (pnpm 11 added `doctor`), so a
// colliding script must be called as `pnpm run <name>` in the Makefile and in current guidance.
// `test` and `start` are excluded: pnpm runs the script for those.
const PNPM_BUILTINS = new Set(
  (
    'add approve-builds audit bin cat-file cat-index clean config create dedupe deploy dlx ' +
    'doctor env exec fetch find-hash i ignored-builds import init install install-test it ' +
    'licenses link list ln ls outdated pack patch patch-commit patch-remove prune publish rb ' +
    'rebuild remove rm root runtime self-update server setup stage store unlink up update why'
  ).split(' '),
);
const guidance = [
  ...['AGENTS.md', 'README.md', 'CONTRIBUTING.md'].map((path) => join(root, path)),
  ...walk(join(root, 'docs/development')).filter((path) => extname(path) === '.md'),
  ...walk(join(root, 'docs/specs')).filter((path) => extname(path) === '.md'),
];
for (const script of Object.keys(pkg.scripts).filter((name) => PNPM_BUILTINS.has(name))) {
  if (new RegExp(`^\\s+pnpm ${script}\\b`, 'm').test(makefile))
    problems.push(`Makefile must call \`pnpm run ${script}\` (pnpm built-in shadows the script)`);
  for (const file of guidance)
    if (new RegExp(`\`pnpm ${script}\\b`).test(readFileSync(file, 'utf8')))
      problems.push(`${relative(root, file)}: write \`pnpm run ${script}\` (pnpm built-in)`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Verified ${authored.length} authored Markdown files, ${lock.skills.length} pinned skills and root command mirrors.`,
  );
