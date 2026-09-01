-- Automation Health Center v1
-- Normalized execution ledger for n8n, Edge Functions, schedulers and other server-side automations.
-- Browser clients may read tenant-scoped rows but may not create or mutate execution history.

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  automation_key text not null,
  automation_name text not null,
  source text not null,
  trigger_type text not null default 'event',
  status text not null,
  run_ref text,
  correlation_key text,
  record_type text,
  record_id text,
  attempt_number integer not null default 1,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint automation_runs_automation_key_not_blank check (btrim(automation_key) <> ''),
  constraint automation_runs_automation_name_not_blank check (btrim(automation_name) <> ''),
  constraint automation_runs_source_check check (source in ('n8n', 'edge_function', 'scheduler', 'database', 'system')),
  constraint automation_runs_trigger_type_check check (trigger_type in ('event', 'scheduled', 'manual', 'webhook', 'retry')),
  constraint automation_runs_status_check check (status in ('running', 'succeeded', 'failed', 'suppressed', 'skipped')),
  constraint automation_runs_attempt_number_check check (attempt_number >= 1),
  constraint automation_runs_duration_check check (duration_ms is null or duration_ms >= 0),
  constraint automation_runs_time_order_check check (finished_at is null or finished_at >= started_at)
);

create index if not exists automation_runs_workspace_started_idx
  on public.automation_runs (workspace_id, started_at desc);

create index if not exists automation_runs_workspace_automation_started_idx
  on public.automation_runs (workspace_id, automation_key, started_at desc);

create index if not exists automation_runs_workspace_status_started_idx
  on public.automation_runs (workspace_id, status, started_at desc);

create unique index if not exists automation_runs_workspace_correlation_attempt_uidx
  on public.automation_runs (workspace_id, automation_key, correlation_key, attempt_number)
  where correlation_key is not null;

alter table public.automation_runs enable row level security;

drop policy if exists automation_runs_member_read on public.automation_runs;
create policy automation_runs_member_read
  on public.automation_runs
  for select
  to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- Health history is an observability ledger. Authenticated browser clients are intentionally read-only.
revoke all on public.automation_runs from anon;
revoke insert, update, delete on public.automation_runs from authenticated;
grant select on public.automation_runs to authenticated;
grant select, insert, update, delete on public.automation_runs to service_role;

comment on table public.automation_runs is
  'Tenant-scoped server-written execution ledger used by Automation Health Center. Authenticated clients are read-only.';
comment on column public.automation_runs.correlation_key is
  'Logical execution/idempotency correlation key when the producing automation has one.';
comment on column public.automation_runs.run_ref is
  'Provider execution reference such as an n8n execution ID or Edge request/run identifier.';
