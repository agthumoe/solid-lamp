import { createHash } from 'node:crypto';

import type { SourceObservation } from './change-plan.ts';
import type { SourceReader } from './source-reader.ts';

// The revision is the SHA-256 of the exact bytes, so frontmatter-only and newline-only edits
// are real changes (review F5). Content is used for hashing only and not retained here.
const revisionOf = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');

export const observePaths = async (
  reader: Pick<SourceReader, 'open'>,
  paths: readonly string[],
): Promise<SourceObservation[]> => {
  const observations: SourceObservation[] = [];
  for (const path of paths) {
    const result = await reader.open(path);
    if (result.ok)
      observations.push({ kind: 'present', path, revision: revisionOf(result.file.content) });
    else if (result.reason === 'not_found') observations.push({ kind: 'missing', path });
    else observations.push({ kind: 'refused', path, reason: result.reason });
  }
  return observations;
};

export type ScanResult =
  | { readonly complete: true; readonly observations: readonly SourceObservation[] }
  | { readonly complete: false; readonly error: string };

/** A full resync: complete only when the verified listing succeeded (it never truncates). */
export const scanSource = async (
  reader: Pick<SourceReader, 'open' | 'list'>,
): Promise<ScanResult> => {
  let paths: string[];
  try {
    paths = await reader.list();
  } catch (error) {
    return { complete: false, error: (error as Error).message };
  }
  return { complete: true, observations: await observePaths(reader, paths) };
};
