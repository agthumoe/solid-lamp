// `pnpm run brain:query "<question>"`: hybrid search through the protected brain api.
import { processIo, runQuery } from './brain-cli.ts';

process.exitCode = await runQuery(process.argv.slice(2), process.env, processIo);
