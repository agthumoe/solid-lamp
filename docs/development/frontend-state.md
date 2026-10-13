# Frontend and state standards

## Feature structure and components

Next.js `app/` owns routing/layout/providers and composes features. Feature directories own `api/`, `components/`, `hooks/`, `stores/` and local helpers. Shared UI primitives have no feature-specific fetching or business rules. Features depend on shared modules; cross-feature coordination belongs in a page/application module. Use Server Components for static composition and initial reads where useful; mark only interactive boundaries `use client`.

A component must have one clear purpose stated by its name. Pages compose feature sections; a section coordinates one workflow; leaf components render a control/item. Extract query/mutation/stream orchestration into focused hooks, and pure transformations into pure helpers. Never bury components inside another component's render function. Prefer slots/children and explicit variants over collections of boolean mode props. Avoid passing the whole store or a large domain object when a few typed props suffice.

Size policy: target ≤100 nonblank lines per component function; >150 triggers extraction/review; >250 nonblank lines per authored frontend file needs decomposition or a documented issue/PR exception. A shorter component with three responsibilities still fails review. Generated/vendored code and isolated fixtures are excluded. No arbitrary micro-components solely to meet a line count. Separate stable visual units, behavior, and independently testable transformations.

Accessibility is part of behavior: semantic HTML, explicit form labels, keyboard operation, focus return, dialog roles, meaningful errors and reduced-motion support. Provide loading/empty/error/stale/disabled states. Test outcomes through the DOM and accessibility roles rather than component internals.

## State ownership

| State | Owner | Examples |
|---|---|---|
| Remote authoritative state | TanStack Query | Runs, approvals, search results, source health |
| Shareable navigation | URL/search params | Search query, filters, selected run |
| Isolated interaction | useState / useReducer | Draft input, a local disclosure, related form transitions |
| Shared ephemeral client state | Zustand | Console panel preference, command palette, ephemeral selection |
| Mutable value without rendering | useRef | Stream handle, timer, DOM node |
| Derived value | Render/pure helper; memo only when justified | Filtered options, selected row, totals |

Do not copy fetched entities into Zustand. Store selected IDs, then derive the selected entity from Query. Do not persist credentials, prompts, note content, approvals or server entities in browser storage. Persist only allowlisted nonsensitive preferences with schema version/migration/reset.

### TanStack Query

Feature API modules export typed fetchers, query-key factories and `queryOptions`; hooks add component-specific enablement. Query keys include every server filter/scope/cursor. Pass Query's AbortSignal to fetch; validate response contracts; throw typed API errors. Choose documented staleTime/refetch/retry policies per resource, since library defaults are not application requirements. Never retry auth/validation failures; bound transient read retries. Approval mutations have retries disabled and use idempotency keys.

Invalidate the narrow relevant keys after mutations, or use `setQueryData` with a verified full DTO. Await invalidation when the UI must show reconciled state. Optimistic updates need snapshot, rollback and reconciliation; do not optimistically mark an external action executed or an approval accepted. Query handles pending/error state; do not duplicate it in useState.

Keep a stable browser QueryClient and a request-local server QueryClient. SSR prefetch/hydrate uses identical keys and safe serialized DTOs. Clear scoped cached state on logout/scope change. Bound cache retention for personal data. SSE events update Query through a typed event adapter, dedup by sequence, and resync after gaps.

### Zustand

Small feature-scoped stores; actions express intent and updates are immutable. Select the smallest primitive/function needed (`useStore(s => s.panel)`); use the installed version's shallow comparison API for derived object selectors when necessary. Avoid subscribing to the whole store. Reset at session boundaries. Never put global mutable request-specific stores in SSR modules; use a store factory/provider per request or mounted scope and align initial state to avoid hydration mismatches. React Server Components do not mutate/read a shared client store.

## Hooks rules

| Hook | Appropriate use | Prohibited shortcut |
|---|---|---|
| useState | Minimal independent local state; functional updates when using previous value; lazy initializer for expensive initial computation | Mirroring props, Query results or derived values |
| useReducer | Multiple related transitions with explicit invariants | Giant reducer owning every feature |
| useMemo | Measured costly pure transform or identity needed by a memoized boundary; complete dependencies | Every small expression; side effects; correctness relying on permanent cache |
| useCallback | Stable handler identity required by memoized children/subscription APIs; complete deps or functional updates | Wrapping all handlers or hiding stale closures with empty deps |
| useEffect | Synchronize with an external system; symmetrical cleanup; exhaustive deps; Strict Mode safe | Fetching ordinary API data, derived-state updates, event-triggered mutations |
| useRef | DOM/subscription/timer identity or transient mutable data | Hiding render-relevant state outside React |

Hooks execute unconditionally at the top level. Treat exhaustive-deps failures as design feedback. For a new props scope, use a keyed component or explicit state transition rather than reset effects. Memoization is a performance decision with before/after evidence, never a correctness requirement.

References: [React effects](https://react.dev/learn/you-might-not-need-an-effect), [useCallback](https://react.dev/reference/react/useCallback), [Query defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults), [Zustand guides](https://github.com/pmndrs/zustand), [Bulletproof React](https://github.com/alan2207/bulletproof-react). These are adapted principles; Aetherion retains Next.js/Fastify, Query and local-only inference.
