# Frontend reference patterns

These are illustrative typed patterns, not application implementation. Imports and DTOs are supplied by the Phase 4 frontend scaffold; examples must be adapted/typechecked against the pinned dependencies then.

## Query ownership and a small coordinating component

```tsx
// features/approvals/api/approval-queries.ts
export const approvalKeys = {
  all: ['approvals'] as const,
  pending: () => [...approvalKeys.all, 'pending'] as const,
};

export const pendingApprovalsOptions = () => queryOptions({
  queryKey: approvalKeys.pending(),
  queryFn: ({ signal }) => api.get('/api/v1/approvals?status=pending', {
    signal,
    schema: pendingApprovalsResponseSchema,
  }),
  staleTime: 5_000,
  retry: (count, error) => count < 2 && isTransientReadError(error),
});

// features/approvals/hooks/use-decide-approval.ts
export function useDecideApproval() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (command: DecideApprovalCommand) => api.post(
      `/api/v1/approvals/${command.id}/decision`,
      command,
      { schema: approvalDecisionResponseSchema },
    ),
    retry: false,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: approvalKeys.all });
    },
  });
}

// features/approvals/components/pending-approvals.tsx
export function PendingApprovals() {
  const query = useQuery(pendingApprovalsOptions());
  if (query.isPending) return <ApprovalListSkeleton />;
  if (query.isError) return <QueryError error={query.error} onRetry={query.refetch} />;
  if (query.data.items.length === 0) return <NoPendingApprovals />;
  return <ApprovalList items={query.data.items} />;
}
```

`ApprovalList` renders items; `ApprovalCard` owns one approval presentation; a focused decision control owns its mutation. Do not combine list fetching, SSE, selection preferences, markdown rendering and decision forms into the page. A decision control creates a stable idempotency key when the user confirms the action and reuses that command/key on an explicit retry. It never marks the external effect executed optimistically.

## Local state and minimal Zustand subscription

```tsx
// Client-only preference store; for SSR use a scoped factory/provider.
export const createConsoleStore = () => createStore<ConsoleState>()((set) => ({
  panel: 'runs',
  setPanel: (panel) => set({ panel }),
}));

export function SearchBox({ onSearch }: { onSearch: (query: string) => void }) {
  const [draft, setDraft] = useState('');
  const canSubmit = draft.trim().length > 0;
  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      if (canSubmit) onSearch(draft.trim());
    }}>
      <label htmlFor="brain-query">Search brain</label>
      <input id="brain-query" value={draft}
        onChange={(event) => setDraft(event.target.value)} />
      <button disabled={!canSubmit}>Search</button>
    </form>
  );
}
```

The submitted query goes to the URL and Query key; the draft stays local. A preference consumer uses a scoped selector, such as `useConsoleStore(s => s.panel)`. It does not copy results into the store. The simple `canSubmit` derivation needs neither state nor useMemo; inline handlers need no useCallback unless identity affects a measured boundary.

## Memoization and Effect cleanup

```tsx
// Only after profiling a costly transform:
const rows = useMemo(() => buildGraphRows(nodes, filter), [nodes, filter]);
// Useful when passed to a measured memoized child:
const toggle = useCallback(() => setExpanded(value => !value), []);

// A focused hook for an actual external subscription:
useEffect(() => {
  const stream = connectRunEvents(runId, {
    onEvent: event => reconcileRunEvent(queryClient, event),
    onGap: () => void queryClient.invalidateQueries({ queryKey: runKeys.detail(runId) }),
  });
  return () => stream.close();
}, [runId, queryClient]);
```

`connectRunEvents` handles auth, sequence dedup, retry bounds and heartbeat; reconciliation updates Query, not a second Zustand run cache. Cleanup is symmetrical and safe under Strict Mode. Ordinary fetches use Query; a user decision happens in an event/mutation handler, not an Effect. A memoized callback depending on props needs those dependencies; an empty array is not a stale-closure fix.
