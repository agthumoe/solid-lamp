# Template: Zustand store (shared ephemeral client state)

Real home: `apps/web/src/features/<feature>/stores/<name>-store.ts`. Use only for UI state shared by several components that isn't server data and isn't URL state (for example, the chat composer draft and the selected agent). Rules: [frontend and state](../frontend-state.md#zustand).

```ts
import { create } from 'zustand';

type ComposerState = {
  draft: string;
  selectedAgent: string | undefined; // undefined = let the router decide
  setDraft: (draft: string) => void;
  selectAgent: (slug: string | undefined) => void;
  reset: () => void;
};

const initial = { draft: '', selectedAgent: undefined };

export const useComposerStore = create<ComposerState>()((set) => ({
  ...initial,
  setDraft: (draft) => set({ draft }),
  selectAgent: (selectedAgent) => set({ selectedAgent }),
  reset: () => set(initial),
}));

// Components subscribe to the smallest slice they need:
// const draft = useComposerStore((s) => s.draft);
// const setDraft = useComposerStore((s) => s.setDraft);
```

Checklist: no fetched data; no derived values stored (compute in selectors); narrow selectors; one store per feature concern; a `reset` for tests and logout; no secrets or private content persisted to storage.
