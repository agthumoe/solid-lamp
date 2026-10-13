// Issue #1: verify authored Markdown links and pinned project-skill integrity.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems: string[] = [];
function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
const authored = [...walk(join(root, 'docs')).filter(path => extname(path) === '.md'),
  ...['AGENTS.md', 'CLAUDE.md', 'README.md', 'CONTRIBUTING.md', 'THIRD_PARTY_NOTICES.md'].map(path => join(root, path))];
for (const file of authored) {
  const markdown = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1].trim().replace(/^<|>$/g, '').split('#')[0];
    if (!link || /^(https?:|mailto:|app:)/.test(link)) continue;
    const target = resolve(dirname(file), decodeURIComponent(link));
    if (!existsSync(target)) problems.push(`${relative(root, file)}: broken link ${link}`);
  }
}
interface SkillLock { name: string; directory: string; commit: string; files: Record<string, string> }
const lock = JSON.parse(readFileSync(join(root, 'docs/development/skills-lock.json'), 'utf8')) as { skills: SkillLock[] };
for (const skill of lock.skills) {
  if (!/^[a-f0-9]{40}$/.test(skill.commit)) problems.push(`${skill.name}: unpinned commit`);
  const base = resolve(root, skill.directory);
  const actual = walk(base).map(path => relative(base, path)).sort();
  const expected = Object.keys(skill.files).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) problems.push(`${skill.name}: file inventory differs from lock`);
  for (const [path, hash] of Object.entries(skill.files)) {
    const file = join(base, path);
    if (!existsSync(file)) { problems.push(`${skill.name}: missing ${path}`); continue; }
    if (createHash('sha256').update(readFileSync(file)).digest('hex') !== hash) problems.push(`${skill.name}: changed ${path}`);
  }
  const entry = readFileSync(join(base, 'SKILL.md'), 'utf8');
  const frontmatter = entry.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const metadata = frontmatter ? parse(frontmatter[1]) : {};
  if (metadata.name !== skill.name || metadata.license !== 'MIT') problems.push(`${skill.name}: unexpected skill name/license`);
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
for (const script of Object.keys(pkg.scripts)) {
  if (!makefile.includes(`${script.replaceAll(':', '\\:')}:`)) problems.push(`Missing Makefile mirror: ${script}`);
}
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
else console.log(`Verified ${authored.length} authored Markdown files, ${lock.skills.length} pinned skills and root command mirrors.`);
