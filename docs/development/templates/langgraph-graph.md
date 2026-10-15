# Template: LangGraph graph

Real home: `packages/agents/src/graphs/<graph>/` (`state.ts`, `nodes/<node>.ts`, `graph.ts`). Guide: [AI orchestration](../ai-orchestration.md). Tool executor: [tool-definition.ts](tool-definition.ts). Not compiled until Phase 3 installs LangGraph; check the API against the pinned version then.

## `state.ts`: serializable state only

```ts
import { Annotation, MessagesAnnotation } from '@langchain/langgraph';

export const AnswerState = Annotation.Root({
  ...MessagesAnnotation.spec,
  question: Annotation<string>(),
  chunkRefs: Annotation<{ chunkId: string; citation: string }[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  steps: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
  outcome: Annotation<'answered' | 'no_evidence' | 'limit_reached' | undefined>(),
});
export type AnswerStateT = typeof AnswerState.State;
```

## `nodes/retrieve.ts`: one responsibility, deps injected

```ts
import type { BrainSearch } from '@aetherion/brain';
import type { AnswerStateT } from '../state.ts';

export const makeRetrieveNode =
  (deps: { brain: BrainSearch; scope: BrainScope }) =>
  async (state: AnswerStateT, config: { signal?: AbortSignal }): Promise<Partial<AnswerStateT>> => {
    const hits = await deps.brain.search(state.question, deps.scope, config.signal);
    return {
      chunkRefs: hits.map((h) => ({ chunkId: h.chunkId, citation: h.citation })), // references, not full text
      outcome: hits.length === 0 ? 'no_evidence' : undefined,
      steps: 1,
    };
  };
```

## `graph.ts`: wiring only

```ts
import { END, START, StateGraph } from '@langchain/langgraph';
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

export const buildAnswerGraph = (deps: AnswerGraphDeps, checkpointer: PostgresSaver) =>
  new StateGraph(AnswerState)
    .addNode('retrieve', makeRetrieveNode(deps))
    .addNode('answer', makeAnswerNode(deps)) // calls inference with role + priority + deadline
    .addNode('no_evidence', makeNoEvidenceNode())
    .addEdge(START, 'retrieve')
    // Route on typed state, never on free model text.
    .addConditionalEdges('retrieve', (s) =>
      s.outcome === 'no_evidence' ? 'no_evidence' : 'answer',
    )
    .addEdge('answer', END)
    .addEdge('no_evidence', END)
    .compile({ checkpointer });

// Invocation: thread_id = runId; limits from agent config.
// graph.stream(input, { configurable: { thread_id: runId }, recursionLimit: limits.max_steps, signal })
```

## Approval node pattern

```ts
import { interrupt } from '@langchain/langgraph';

// Inside the node that handles a proposed side-effect call:
const outcome = await executeToolCall(tool, allowlist, args, ctx); // see tool-definition.ts
if (outcome.ok && outcome.value.kind === 'approval_required') {
  // Pauses the run; api persists approval + audit + outbox. Resume value is the owner's decision.
  const decision = interrupt({ approval: outcome.value });
  // On resume: dispatch once with idempotency key only if decision is approved and hash matches.
}
```

Checklist: state serializable and bounded; nodes get `deps`; graph file has no logic beyond routing; `thread_id = runId`; recursion limit + deadline + signal; approval via `interrupt()`; node unit tests with fake inference.
