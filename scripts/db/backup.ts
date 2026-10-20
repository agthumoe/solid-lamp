// `pnpm run db:backup` (#87): dump the primary database into backups/ with a checksum and a
// manifest of counts/IDs/hashes, then apply retention. See docs/specs/recovery-gate.md.
import { backup } from './recovery.ts';
import { loadRecoveryConfig } from './recovery-core.ts';

try {
  const config = loadRecoveryConfig(process.env);
  const result = await backup(config);
  console.log(`backup ${result.file}`);
  console.log(`sha256 ${result.sha256}`);
  if (result.pruned.length) console.log(`pruned ${result.pruned.join(', ')}`);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
