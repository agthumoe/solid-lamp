import { z } from 'zod';

const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,96}$/);
const privatePath = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (path) =>
      !path.startsWith('/') &&
      !/^[a-z][a-z\d+.-]*:/i.test(path) &&
      !path.includes('\\') &&
      ![...path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
      path.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
  );
export const citationSchema = z.strictObject({
  sourceId: identifier,
  path: privatePath,
  headingPath: z.array(z.string().max(500)).max(32),
});
export const questionSchema = z
  .strictObject({
    id: identifier,
    query: z.string().trim().min(1).max(8192),
    split: z.enum(['calibration', 'held_out']),
    answerable: z.boolean(),
    expected: z.array(citationSchema).max(50),
  })
  .refine((question) =>
    question.answerable ? question.expected.length > 0 : question.expected.length === 0,
  );
export const hitSchema = z.strictObject({
  chunkId: identifier,
  citation: citationSchema,
  citationVerified: z.boolean(),
});
export const observationSchema = z
  .strictObject({
    questionId: identifier,
    status: z.enum(['ok', 'no_match', 'unavailable', 'not_indexed', 'incomplete', 'lexical_only']),
    hits: z.array(hitSchema).max(50),
    latencyMs: z.number().finite().min(0).max(86_400_000),
  })
  .refine(({ status, hits }) =>
    status === 'ok'
      ? hits.length > 0
      : ['no_match', 'unavailable', 'not_indexed'].includes(status)
        ? hits.length === 0
        : true,
  );
export const evaluationRunSchema = z.strictObject({
  evidenceKind: z.enum(['synthetic_fake', 'synthetic_local_model', 'real_vault_local']),
  profileId: identifier,
  chunkerVersion: identifier,
  thresholdVersion: identifier,
  questions: z.array(questionSchema).min(1).max(1000),
  observations: z.array(observationSchema).min(1).max(1000),
});
export type Citation = z.infer<typeof citationSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Hit = z.infer<typeof hitSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type EvaluationRun = z.infer<typeof evaluationRunSchema>;
