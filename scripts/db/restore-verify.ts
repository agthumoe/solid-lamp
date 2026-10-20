// `pnpm run db:restore-verify [dump] [--keep]` (#87): restore into a new isolated database,
// compare with the backup manifest, then drop it unless --keep. Never touches the primary.
import { newestDump, restoreVerify } from './recovery.ts';
import { loadRecoveryConfig } from './recovery-core.ts';

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const dump = args.find((arg) => !arg.startsWith('--'));

try {
  const config = loadRecoveryConfig(process.env);
  const file = dump ?? (await newestDump(config));
  const result = await restoreVerify(config, file, { keep });
  if (result.problems.length) {
    console.error(`restore of ${file} FAILED verification in ${result.target}:`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  } else console.log(`restore of ${file} verified in ${result.target}`);
  console.log(result.kept ? `kept ${result.target} for inspection` : `dropped ${result.target}`);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
