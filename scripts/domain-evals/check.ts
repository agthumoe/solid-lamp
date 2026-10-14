import { fileURLToPath } from 'node:url';
import { safeError } from './errors.ts';
import { loadDomainData } from './load.ts';

try {
  const result = loadDomainData(fileURLToPath(new URL('../../evals/domain/', import.meta.url)));
  console.log(
    'Validated ' +
      result.cases +
      ' schema-v2 domain design cases; no formulas, policy or models executed.',
  );
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
}
