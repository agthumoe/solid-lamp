export {
  inferenceError,
  INFERENCE_ERROR_CODES,
  type InferenceError,
  type InferenceErrorCode,
} from './errors.ts';
export {
  LlmGate,
  type GateJob,
  type GateLimits,
  type GateMetrics,
  type GateRunOptions,
  type Priority,
} from './gate/llm-gate.ts';
export {
  embedInBatches,
  scheduleGeneration,
  type CallOptions,
  type ScheduleDeps,
  type ScheduledGeneration,
} from './gate/schedule.ts';
export {
  collectStream,
  type FinishReason,
  type GenerationTimings,
  type NativeToolCall,
  type ResolvedModel,
  type StreamDone,
  type StreamEvent,
  type StreamFailure,
  type StreamOutcome,
} from './inference/stream-event.ts';
export { repairToolCalls } from './repair/repair-tool-calls.ts';
export {
  validateToolCall,
  type ToolAllowlist,
  type ToolCall,
  type ToolCallError,
  type ToolCallErrorCode,
} from './repair/tool-call.ts';
export {
  resolveEmbedRole,
  resolveGenerationRole,
  type EmbedSnapshot,
  type GenerationRole,
  type GenerationSnapshot,
  type SamplingOptions,
} from './roles/resolve-role.ts';
