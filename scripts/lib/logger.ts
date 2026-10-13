import pino, { type DestinationStream } from 'pino';
import { z } from 'zod';
const eventSchema = z.strictObject({
  event: z.string().regex(/^[a-z0-9_.-]+$/),
  outcome: z.enum(['started', 'complete', 'failed', 'skipped']).optional(),
  role: z.string().optional(),
  durationMs: z.number().finite().nonnegative().optional(),
  count: z.number().int().nonnegative().optional(),
  errorCode: z.string().optional(),
});
export type LogEvent = z.infer<typeof eventSchema>;
export function createLogger(destination: DestinationStream = pino.destination(2)) {
  const logger = pino(
    {
      base: { service: 'aetherion-diagnostics' },
      redact: {
        paths: ['authorization', 'cookie', 'token', 'password', 'prompt', 'content'],
        censor: '[REDACTED]',
      },
    },
    destination,
  );
  // An allowlist stops arbitrary nested payloads before the transport/redaction layer.
  return {
    info: (event: LogEvent) => logger.info(eventSchema.parse(event)),
    error: (event: LogEvent) => logger.error(eventSchema.parse(event)),
  };
}
