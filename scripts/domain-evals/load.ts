import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fail } from './errors.ts';
import { validateDomainData } from './integrity.ts';
import { manifestSchema, type FixturePath } from './schema.ts';

function readRegular(root: string, relative: string): unknown {
  const path = join(root, relative);
  if (
    !lstatSync(path).isFile() ||
    realpathSync(path) !== resolve(path) ||
    !realpathSync(path).startsWith(root + sep)
  )
    fail('DOMAIN_FILE_BOUNDARY');
  return JSON.parse(readFileSync(path, 'utf8'));
}
export function loadDomainData(directory: string) {
  const root = realpathSync(directory);
  const manifest = manifestSchema.parse(readRegular(root, 'manifest.json'));
  const files = new Map<FixturePath, unknown>();
  for (const file of manifest.files) {
    files.set(file.path, readRegular(root, file.path));
  }
  return validateDomainData(manifest, files);
}
