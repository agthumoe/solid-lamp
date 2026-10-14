import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { validateSuite } from './integrity.ts';

try {
  const path = new URL('../../evals/routing/cases.json', import.meta.url);
  const suite = validateSuite(JSON.parse(readFileSync(path, 'utf8')));
  console.log(`Validated ${suite.cases.length} routing design fixtures; no policy/model executed.`);
} catch (error) {
  // Zod's full errors may include private input; report paths/codes only.
  if (error instanceof z.ZodError) {
    console.error(error.issues.map((issue) => `${issue.path.join('.')}: ${issue.code}`).join('\n'));
  } else {
    console.error(
      error instanceof SyntaxError
        ? 'invalid fixture JSON'
        : error instanceof Error && !('code' in error)
          ? error.message
          : 'fixture read/validation failed',
    );
  }
  process.exitCode = 1;
}
