import assert from 'node:assert/strict';
import test from 'node:test';

import { appError, ERROR_CODES, httpStatusFor, toErrorEnvelope } from './errors.ts';

await test('API errors map every declared error code to an HTTP status', () => {
  assert.deepEqual(
    ERROR_CODES.map((code) => httpStatusFor(code)),
    [400, 401, 404, 409, 410, 409, 409, 403, 429, 503],
  );
});

await test('API errors create an envelope with only safe fields and the request ID', () => {
  const error = appError('VALIDATION_FAILED', 'Invalid request.', { fieldCount: 2 });

  assert.deepEqual(toErrorEnvelope(error, 'req_1'), {
    error: {
      code: 'VALIDATION_FAILED',
      message: 'Invalid request.',
      requestId: 'req_1',
      details: { fieldCount: 2 },
    },
  });
});

await test('API errors omit empty details', () => {
  assert.deepEqual(toErrorEnvelope(appError('NOT_FOUND', 'Missing.'), 'req_2'), {
    error: { code: 'NOT_FOUND', message: 'Missing.', requestId: 'req_2' },
  });
});
