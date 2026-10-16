# Template: React feature (web)

Real home: `apps/web/src/features/<feature>/`. Rules: [frontend and state](../frontend-state.md). Fuller component, selector and SSE examples: [examples](../examples.md). Not compiled until Phase 4 installs the frontend stack.

## `api/approval-queries.ts`: query keys and options in one place

```ts
import { queryOptions } from '@tanstack/react-query';
import { approvalListSchema } from '@aetherion/shared/contracts';
import { apiGet } from '@/lib/api-client';

export const approvalKeys = {
  all: ['approvals'] as const,
  list: (status: 'pending' | 'all') => [...approvalKeys.all, 'list', status] as const,
  detail: (id: string) => [...approvalKeys.all, 'detail', id] as const,
};

export const pendingApprovalsQuery = () =>
  queryOptions({
    queryKey: approvalKeys.list('pending'),
    queryFn: ({ signal }) => apiGet('/api/v1/approvals?status=pending', approvalListSchema, signal), // zod-validated
    staleTime: 10_000,
  });
```

## `hooks/use-decide-approval.ts`: mutation + invalidation

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';

export const useDecideApproval = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: decideApprovalRequest, // api/decide-approval.ts
    onSettled: () => queryClient.invalidateQueries({ queryKey: approvalKeys.all }),
  });
};
```

## `components/pending-approvals.tsx`: small, one purpose, all states

```tsx
export function PendingApprovals() {
  const { data, isPending, isError, refetch } = useQuery(pendingApprovalsQuery());
  if (isPending) return <ApprovalListSkeleton />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;
  if (data.items.length === 0) return <EmptyState message="Nothing waiting for you." />;
  return (
    <ul aria-label="Pending approvals">
      {data.items.map((a) => (
        <li key={a.id}>
          <ApprovalCard approval={a} />
        </li>
      ))}
    </ul>
  );
}
```

Checklist: server data only in TanStack Query (never copied into Zustand/useState); keys from the factory; loading/empty/error states; components ≤100 nonblank lines; accessible names; tests with a fresh `QueryClient`.
