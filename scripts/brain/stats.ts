// `pnpm run brain:stats`: index status through the protected brain api.
import { processIo, runStats } from './brain-cli.ts';

process.exitCode = await runStats(process.argv.slice(2), process.env, processIo);
