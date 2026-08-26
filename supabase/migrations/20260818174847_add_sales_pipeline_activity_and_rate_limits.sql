create table if not exists public.pipelines (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('pl_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pipelines_one_default_per_workspace
  on public.pipelines(workspace_id)
  where is_default = true;

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('stg_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  position integer not null,
  stage_type text not null default 'open' check (stage_type in ('open','won','lost')),
  created_at timestamptz not null default now(),
  unique (pipeline_id, position),
  unique (pipeline_id, name)
);

alter table public.leads add column if not exists pipeline_stage_id uuid references public.pipeline_stages(id) on delete set null;

create index if not exists leads_pipeline_stage_id_idx on public.leads(pipeline_stage_id);
create index if not exists pipeline_stages_workspace_id_idx on public.pipeline_stages(workspace_id);
create index if not exists pipeline_stages_pipeline_id_position_idx on public.pipeline_stages(pipeline_id, position);

create table if not exists public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('act_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id bigint not null references public.leads(id) on delete cascade,
  activity_type text not null,
  title text not null,
  metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index if not exists lead_activities_workspace_lead_time_idx
  on public.lead_activities(workspace_id, lead_id, occurred_at desc);

alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.lead_activities enable row level security;

do $$ begin
  create policy "members_select_pipelines" on public.pipelines for select to authenticated
  using (exists (select 1 from public.workspace_members wm where wm.workspace_id = pipelines.workspace_id and wm.user_id = (select auth.uid())));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "admins_insert_pipelines" on public.pipelines for insert to authenticated
  with check (exists (select 1 from public.workspace_members wm where wm.workspace_id = pipelines.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "admins_update_pipelines" on public.pipelines for update to authenticated
  using (exists (select 1 from public.workspace_members wm where wm.workspace_id = pipelines.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin')))
  with check (exists (select 1 from public.workspace_members wm where wm.workspace_id = pipelines.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "admins_delete_pipelines" on public.pipelines for delete to authenticated
  using (exists (select 1 from public.workspace_members wm where wm.workspace_id = pipelines.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin')));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "members_select_pipeline_stages" on public.pipeline_stages for select to authenticated
  using (exists (select 1 from public.workspace_members wm where wm.workspace_id = pipeline_stages.workspace_id and wm.user_id = (select auth.uid())));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "admins_insert_pipeline_stages" on public.pipeline_stages for insert to authenticated
  with check (exists (select 1 from public.workspace_members wm where wm.workspace_id = pipeline_stages.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "admins_update_pipeline_stages" on public.pipeline_stages for update to authenticated
  using (exists (select 1 from public.workspace_members wm where wm.workspace_id = pipeline_stages.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin')))
  with check (exists (select 1 from public.workspace_members wm where wm.workspace_id = pipeline_stages.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "admins_delete_pipeline_stages" on public.pipeline_stages for delete to authenticated
  using (exists (select 1 from public.workspace_members wm where wm.workspace_id = pipeline_stages.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin')));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "members_select_activities" on public.lead_activities for select to authenticated
  using (exists (select 1 from public.workspace_members wm where wm.workspace_id = lead_activities.workspace_id and wm.user_id = (select auth.uid())));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "members_insert_activities" on public.lead_activities for insert to authenticated
  with check (exists (select 1 from public.workspace_members wm where wm.workspace_id = lead_activities.workspace_id and wm.user_id = (select auth.uid())));
exception when duplicate_object then null; end $$;

create schema if not exists private;

create or replace function private.log_pipeline_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  old_name text;
  new_name text;
begin
  if new.pipeline_stage_id is not distinct from old.pipeline_stage_id then
    return new;
  end if;

  select name into old_name from public.pipeline_stages where id = old.pipeline_stage_id;
  select name into new_name from public.pipeline_stages where id = new.pipeline_stage_id;

  if new.workspace_id is not null then
    insert into public.lead_activities(workspace_id, lead_id, activity_type, title, metadata, actor_user_id)
    values (
      new.workspace_id,
      new.id,
      'pipeline_stage_changed',
      coalesce(old_name, 'Unstaged') || ' → ' || coalesce(new_name, 'Unstaged'),
      jsonb_build_object('from_stage_id', old.pipeline_stage_id, 'to_stage_id', new.pipeline_stage_id, 'from_stage', old_name, 'to_stage', new_name),
      auth.uid()
    );
  end if;
  return new;
end;
$$;

revoke all on function private.log_pipeline_stage_change() from public;

drop trigger if exists trg_log_pipeline_stage_change on public.leads;
create trigger trg_log_pipeline_stage_change
after update of pipeline_stage_id on public.leads
for each row execute function private.log_pipeline_stage_change();

create or replace function private.log_note_activity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.lead_activities(workspace_id, lead_id, activity_type, title, metadata, actor_user_id)
  values (new.workspace_id, new.lead_id, 'note_added', 'Internal note added', jsonb_build_object('note_id', new.public_id), new.created_by);
  return new;
end;
$$;
revoke all on function private.log_note_activity() from public;
drop trigger if exists trg_log_note_activity on public.lead_notes;
create trigger trg_log_note_activity after insert on public.lead_notes for each row execute function private.log_note_activity();

create or replace function private.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lead_activities(workspace_id, lead_id, activity_type, title, metadata, actor_user_id)
    values (new.workspace_id, new.lead_id, 'task_created', 'Follow-up task created', jsonb_build_object('task_id', new.public_id, 'task_title', new.title, 'priority', new.priority, 'due_at', new.due_at), new.created_by);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.lead_activities(workspace_id, lead_id, activity_type, title, metadata, actor_user_id)
    values (new.workspace_id, new.lead_id, case when new.status = 'done' then 'task_completed' else 'task_reopened' end, case when new.status = 'done' then 'Follow-up task completed' else 'Follow-up task reopened' end, jsonb_build_object('task_id', new.public_id, 'task_title', new.title), auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function private.log_task_activity() from public;
drop trigger if exists trg_log_task_activity on public.lead_tasks;
create trigger trg_log_task_activity after insert or update of status on public.lead_tasks for each row execute function private.log_task_activity();

insert into public.pipelines(workspace_id, name, is_default)
select w.id, 'Sales Pipeline', true
from public.workspaces w
where w.slug = 'my-workspace'
  and not exists (select 1 from public.pipelines p where p.workspace_id = w.id and p.is_default = true);

with default_pipeline as (
  select p.id, p.workspace_id from public.pipelines p
  join public.workspaces w on w.id = p.workspace_id
  where w.slug = 'my-workspace' and p.is_default = true
  limit 1
), stages(name, position, stage_type) as (
  values
    ('New', 10, 'open'),
    ('Contacted', 20, 'open'),
    ('Qualified', 30, 'open'),
    ('Proposal', 40, 'open'),
    ('Negotiation', 50, 'open'),
    ('Won', 60, 'won'),
    ('Lost', 70, 'lost')
)
insert into public.pipeline_stages(pipeline_id, workspace_id, name, position, stage_type)
select dp.id, dp.workspace_id, s.name, s.position, s.stage_type
from default_pipeline dp cross join stages s
on conflict (pipeline_id, name) do nothing;

update public.leads l
set pipeline_stage_id = s.id
from public.pipeline_stages s
join public.pipelines p on p.id = s.pipeline_id and p.is_default = true
join public.workspaces w on w.id = p.workspace_id and w.slug = 'my-workspace'
where l.workspace_id = w.id and l.pipeline_stage_id is null and s.name = 'New';

create table if not exists public.automation_rate_limit_counters (
  rate_key text primary key,
  window_start timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.automation_rate_limit_counters enable row level security;
revoke all on table public.automation_rate_limit_counters from anon, authenticated;
grant select, insert, update, delete on table public.automation_rate_limit_counters to service_role;

create or replace function public.consume_automation_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns table(allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := clock_timestamp();
  new_count integer;
  active_window timestamptz;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate limit configuration';
  end if;

  insert into public.automation_rate_limit_counters as c(rate_key, window_start, request_count, updated_at)
  values (p_key, now_ts, 1, now_ts)
  on conflict (rate_key) do update set
    window_start = case when c.window_start <= now_ts - make_interval(secs => p_window_seconds) then now_ts else c.window_start end,
    request_count = case when c.window_start <= now_ts - make_interval(secs => p_window_seconds) then 1 else c.request_count + 1 end,
    updated_at = now_ts
  returning request_count, window_start into new_count, active_window;

  allowed := new_count <= p_limit;
  remaining := greatest(p_limit - new_count, 0);
  retry_after_seconds := case when allowed then 0 else greatest(ceil(extract(epoch from (active_window + make_interval(secs => p_window_seconds) - now_ts)))::integer, 1) end;
  return next;
end;
$$;

revoke all on function public.consume_automation_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_automation_rate_limit(text, integer, integer) to service_role;
;
