# Template: SQL migration

Real home: `supabase/migrations/<UTC yyyymmddhhmmss>_<snake_name>.sql`, the only schema history ([database](../database.md), [Supabase Postgres skill](../../../.agents/skills/supabase-postgres-best-practices/SKILL.md)). Then mirror the table in `packages/db/src/schema/<table>.ts` and run the drift check.

```sql
-- 20261020120000_create_approvals.sql
-- Why: approval queue for side-effect tool calls (spec: docs/specs/approvals.md, issue #NN).
-- Rollback/forward-fix: drop is safe before any data; afterwards forward-fix only.

create table public.approvals (
  id            text primary key,
  run_id        text not null references public.runs (id) on delete cascade,
  tool_name     text not null,
  payload_hash  text not null check (length(payload_hash) = 64),
  status        text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected', 'expired')),
  expires_at    timestamptz not null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint approvals_decided_consistent
    check ((status = 'pending') = (decided_at is null))
);

-- Index the foreign key and the dashboard's "pending, soonest expiry" query.
create index approvals_run_id_idx on public.approvals (run_id);
create index approvals_pending_expiry_idx on public.approvals (expires_at) where status = 'pending';

-- Single-user app behind owner auth, but RLS on by default so accidental exposure fails closed.
alter table public.approvals enable row level security;
```

Checklist: header says why, issue and rollback stance; constraints encode invariants; every FK indexed; no destructive change without an expand/contract plan; `timestamptz` everywhere; applied with the Supabase CLI, never `drizzle-kit push`.
