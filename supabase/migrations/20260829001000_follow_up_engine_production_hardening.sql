-- Follow-Up Engine production hardening.
-- Source-only until explicitly applied to production.
-- Adds per-workspace configuration, tenant integrity, machine-only idempotency,
-- and a database-level production guard for automated follow-up tasks.

create table if not exists public.workspace_follow_up_settings (
  workspace_id uuid primary key
    references public.workspaces(id) on delete cascade,
  enabled boolean not null default false,
  timezone text not null default 'UTC'
    check (char_length(timezone) between 1 and 100),
  hot_stale_hours integer not null default 2
    check (hot_stale_hours between 1 and 168),
  warm_stale_hours integer not null default 24
    check (warm_stale_hours between 1 and 720),
  max_tasks_per_run integer not null default 1
    check (max_tasks_per_run between 1 and 25),
  max_tasks_per_day integer not null default 10
    check (max_tasks_per_day between 1 and 200),
  paused_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.workspace_follow_up_settings is
  'Per-workspace controls for the internal Follow-Up Engine. Rows default disabled; production writes also require a qualifying Starter+ subscription.';
comment on column public.workspace_follow_up_settings.enabled is
  'Workspace-level opt-in. Global n8n production_mode and write_enabled remain separate kill switches.';
comment on column public.workspace_follow_up_settings.timezone is
  'IANA timezone used for same-day idempotency and per-day caps. Invalid zones fail closed at runtime/database guardrails.';
comment on column public.workspace_follow_up_settings.max_tasks_per_run is
  'Per-workspace fairness cap applied by n8n before the global run cap.';
comment on column public.workspace_follow_up_settings.max_tasks_per_day is
  'Per-workspace daily production safety cap enforced again at the database boundary.';

drop trigger if exists trg_workspace_follow_up_settings_updated_at
  on public.workspace_follow_up_settings;
create trigger trg_workspace_follow_up_settings_updated_at
before update on public.workspace_follow_up_settings
for each row execute function private.set_updated_at();

alter table public.workspace_follow_up_settings enable row level security;

drop policy if exists workspace_follow_up_settings_member_read
  on public.workspace_follow_up_settings;
create policy workspace_follow_up_settings_member_read
on public.workspace_follow_up_settings
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_follow_up_settings.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

drop policy if exists workspace_follow_up_settings_creator_update
  on public.workspace_follow_up_settings;
create policy workspace_follow_up_settings_creator_update
on public.workspace_follow_up_settings
for update
to authenticated
using (
  exists (
    select 1
    from public.workspaces w
    where w.id = workspace_follow_up_settings.workspace_id
      and w.created_by = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = workspace_follow_up_settings.workspace_id
      and w.created_by = (select auth.uid())
  )
);

-- Explicit grants because public-schema default privileges can vary by project.
revoke all on table public.workspace_follow_up_settings from anon;
revoke all on table public.workspace_follow_up_settings from authenticated;
grant select on table public.workspace_follow_up_settings to authenticated;
grant update (
  enabled,
  timezone,
  hot_stale_hours,
  warm_stale_hours,
  max_tasks_per_run,
  max_tasks_per_day,
  paused_until
) on table public.workspace_follow_up_settings to authenticated;
grant all on table public.workspace_follow_up_settings to service_role;

-- Existing workspaces receive a row, but every row remains disabled.
insert into public.workspace_follow_up_settings (workspace_id)
select w.id
from public.workspaces w
on conflict (workspace_id) do nothing;

-- New workspaces also receive a disabled settings row automatically.
create or replace function private.ensure_workspace_follow_up_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_follow_up_settings (workspace_id)
  values (new.id)
  on conflict (workspace_id) do nothing;

  return new;
end;
$$;

revoke all on function private.ensure_workspace_follow_up_settings() from public;
revoke all on function private.ensure_workspace_follow_up_settings() from anon;
revoke all on function private.ensure_workspace_follow_up_settings() from authenticated;

drop trigger if exists trg_workspaces_ensure_follow_up_settings
  on public.workspaces;
create trigger trg_workspaces_ensure_follow_up_settings
after insert on public.workspaces
for each row execute function private.ensure_workspace_follow_up_settings();

-- Enforce task/lead tenant consistency at the database boundary.
-- Production was checked before this draft: existing task/lead workspace mismatches = 0.
create unique index if not exists uq_leads_workspace_id_id
  on public.leads (workspace_id, id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lead_tasks_workspace_lead_fkey'
      and conrelid = 'public.lead_tasks'::regclass
  ) then
    alter table public.lead_tasks
      add constraint lead_tasks_workspace_lead_fkey
      foreign key (workspace_id, lead_id)
      references public.leads(workspace_id, id)
      on delete cascade
      not valid;

    alter table public.lead_tasks
      validate constraint lead_tasks_workspace_lead_fkey;
  end if;
end;
$$;

-- Atomic duplicate protection for automated tasks.
-- Human-created tasks keep automation_key NULL and are unaffected.
alter table public.lead_tasks
  add column if not exists automation_key text;

comment on column public.lead_tasks.automation_key is
  'Machine-only idempotency key. Production: follow-up:v1:<lead_public_id>:<workspace-local-day>:<routing_status>. QA uses follow-up:qa:v1:...';

create unique index if not exists uq_lead_tasks_workspace_automation_key
  on public.lead_tasks (workspace_id, automation_key)
  where automation_key is not null;

-- Keep automation_key machine-only without breaking the existing Tasks UI.
-- Existing authenticated SELECT/DELETE privileges remain. INSERT/UPDATE are
-- re-granted only for human-editable columns used by the frontend.
revoke insert, update on table public.lead_tasks from authenticated;
grant insert (
  workspace_id,
  lead_id,
  title,
  description,
  status,
  priority,
  due_at,
  assigned_to,
  created_by,
  completed_at,
  updated_at
) on table public.lead_tasks to authenticated;
grant update (
  title,
  description,
  status,
  priority,
  due_at,
  assigned_to,
  completed_at,
  updated_at
) on table public.lead_tasks to authenticated;
grant all on table public.lead_tasks to service_role;

-- Final production-write guard. The n8n workflow pre-filters and caps work,
-- but this trigger makes the important production rules transactional.
-- An advisory xact lock serializes production automated inserts per workspace,
-- so overlapping workflow executions cannot race past the daily cap.
create or replace function private.guard_follow_up_task_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_timezone text;
  v_max_tasks_per_day integer;
  v_paused_until timestamptz;
  v_plan_code text;
  v_subscription_status text;
  v_local_day date;
  v_today_count integer;
  v_is_production boolean;
  v_is_qa boolean;
begin
  if new.automation_key is null then
    return new;
  end if;

  v_is_production := new.automation_key like 'follow-up:v1:%';
  v_is_qa := new.automation_key like 'follow-up:qa:v1:%';

  if not v_is_production and not v_is_qa then
    raise exception 'Unsupported lead_tasks automation_key prefix';
  end if;

  -- Serialize machine-created follow-up tasks for the same workspace.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.workspace_id::text, 0)
  );

  -- QA keys are already protected by exact n8n allowlisting + machine-only
  -- column permissions + the unique automation key. They intentionally do not
  -- require a paid subscription, so controlled QA remains possible.
  if v_is_qa then
    return new;
  end if;

  select
    s.enabled,
    s.timezone,
    s.max_tasks_per_day,
    s.paused_until,
    p.code,
    sub.status
  into
    v_enabled,
    v_timezone,
    v_max_tasks_per_day,
    v_paused_until,
    v_plan_code,
    v_subscription_status
  from public.workspace_follow_up_settings s
  left join public.subscriptions sub
    on sub.workspace_id = s.workspace_id
  left join public.plans p
    on p.id = sub.plan_id
   and p.is_active = true
  where s.workspace_id = new.workspace_id;

  if not found then
    raise exception 'Follow-Up Engine settings missing for workspace %', new.workspace_id;
  end if;

  if v_enabled is not true then
    raise exception 'Follow-Up Engine is disabled for workspace %', new.workspace_id;
  end if;

  if v_paused_until is not null and v_paused_until > now() then
    raise exception 'Follow-Up Engine is paused for workspace %', new.workspace_id;
  end if;

  if coalesce(v_subscription_status, '') not in ('trialing', 'active')
     or coalesce(v_plan_code, '') not in ('starter', 'pro', 'white_label') then
    raise exception 'Workspace % is not entitled to Follow-Up automation', new.workspace_id;
  end if;

  -- Invalid IANA timezone values fail closed here.
  begin
    v_local_day := (now() at time zone v_timezone)::date;
  exception when invalid_parameter_value then
    raise exception 'Invalid Follow-Up Engine timezone for workspace %', new.workspace_id;
  end;

  select count(*)::integer
  into v_today_count
  from public.lead_tasks t
  where t.workspace_id = new.workspace_id
    and t.automation_key like 'follow-up:v1:%'
    and (t.created_at at time zone v_timezone)::date = v_local_day;

  if v_today_count >= v_max_tasks_per_day then
    raise exception 'Follow-Up Engine daily task cap reached for workspace %', new.workspace_id;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_follow_up_task_insert() from public;
revoke all on function private.guard_follow_up_task_insert() from anon;
revoke all on function private.guard_follow_up_task_insert() from authenticated;

drop trigger if exists trg_guard_follow_up_task_insert on public.lead_tasks;
create trigger trg_guard_follow_up_task_insert
before insert on public.lead_tasks
for each row execute function private.guard_follow_up_task_insert();
