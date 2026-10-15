import pino, { type DestinationStream, type Logger as PinoLogger } from 'pino';
import { z } from 'zod';

const identifier = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-zA-Z0-9_.:-]+$/);

const logContextSchema = z.strictObject({
  service: identifier.optional(),
  component: identifier.optional(),
  requestId: identifier.optional(),
  runId: identifier.optional(),
  threadId: identifier.optional(),
  jobId: identifier.optional(),
  stepId: identifier.optional(),
  approvalId: identifier.optional(),
  traceId: identifier.optional(),
});
const loggerIdentitySchema = z.strictObject({
  service: identifier,
  component: identifier.optional(),
});
const logBindingsSchema = logContextSchema.pick({
  requestId: true,
  runId: true,
  threadId: true,
  jobId: true,
  stepId: true,
  approvalId: true,
  traceId: true,
});

const logEventSchema = z.strictObject({
  event: z
    .string()
    .min(1)
    .max(96)
    .regex(/^[a-z0-9_.-]+$/),
  outcome: z.enum(['started', 'complete', 'failed', 'skipped']).optional(),
  role: identifier.optional(),
  durationMs: z.number().finite().nonnegative().optional(),
  queueWaitMs: z.number().finite().nonnegative().optional(),
  count: z.number().int().nonnegative().optional(),
  errorCode: identifier.optional(),
});

export type LogContext = z.infer<typeof logContextSchema>;
export type LogEvent = z.infer<typeof logEventSchema>;
export type LoggerIdentity = { readonly service: string; readonly component?: string };
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogBindings = Pick<
  LogContext,
  'requestId' | 'runId' | 'threadId' | 'jobId' | 'stepId' | 'approvalId' | 'traceId'
>;

export interface Logger {
  child(context: LogBindings): Logger;
  debug(event: LogEvent): void;
  info(event: LogEvent): void;
  warn(event: LogEvent): void;
  error(event: LogEvent): void;
}

const REDACT_PATHS = [
  'authorization',
  'secret',
  'cookie',
  'token',
  'password',
  'apikey',
  'api_key',
  'access_token',
  'refresh_token',
  'client_secret',
  'connection_string',
  'database_url',
  'prompt',
  'content',
  '*.authorization',
  '*.secret',
  '*.cookie',
  '*.token',
  '*.password',
  '*.apikey',
  '*.api_key',
  '*.access_token',
  '*.refresh_token',
  '*.client_secret',
  '*.connection_string',
  '*.database_url',
  '*.prompt',
  '*.content',
];

const wrap = (logger: PinoLogger): Logger => ({
  child: (context) => wrap(logger.child(logBindingsSchema.parse(context))),
  debug: (event) => logger.debug(logEventSchema.parse(event)),
  info: (event) => logger.info(logEventSchema.parse(event)),
  warn: (event) => logger.warn(logEventSchema.parse(event)),
  error: (event) => logger.error(logEventSchema.parse(event)),
});

// Internal transport constructor; only createLogger is exported from the package entry.
export const createPinoLogger = (
  context: LoggerIdentity,
  destination: DestinationStream = pino.destination(1),
  level: LogLevel = 'info',
): PinoLogger =>
  pino(
    {
      level,
      base: loggerIdentitySchema.parse(context),
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    },
    destination,
  );

export const createLogger = (
  context: LoggerIdentity,
  destination: DestinationStream = pino.destination(1),
  level: LogLevel = 'info',
): Logger => wrap(createPinoLogger(context, destination, level));

export const validateLogEvent = (event: unknown): LogEvent => logEventSchema.parse(event);
