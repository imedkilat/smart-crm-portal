create extension if not exists vector with schema extensions;

alter table public.lead_routing_history add column if not exists workspace_id uuid;
alter table public.insights add column if not exists workspace_id uuid;
alter table public.weekly_summary add column if not exists workspace_id uuid;

update public.lead_routing_history h
set workspace_id = l.workspace_id
from public.leads l
where h.lead_id = l.id and h.workspace_id is null;

update public.insights
set workspace_id = (select id from public.workspaces order by created_at asc limit 1)
where workspace_id is null;

update public.weekly_summary
set workspace_id = (select id from public.workspaces order by created_at asc limit 1)
where workspace_id is null;

alter table public.lead_routing_history alter column workspace_id set not null;
alter table public.insights alter column workspace_id set not null;
alter table public.weekly_summary alter column workspace_id set not null;

alter table public.lead_routing_history drop constraint if exists lead_routing_history_workspace_id_fkey;
alter table public.lead_routing_history add constraint lead_routing_history_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.insights drop constraint if exists insights_workspace_id_fkey;
alter table public.insights add constraint insights_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.weekly_summary drop constraint if exists weekly_summary_workspace_id_fkey;
alter table public.weekly_summary add constraint weekly_summary_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;

create index if not exists lead_routing_history_workspace_idx on public.lead_routing_history(workspace_id, changed_at desc);
create index if not exists insights_workspace_idx on public.insights(workspace_id, created_at desc);
create index if not exists weekly_summary_workspace_idx on public.weekly_summary(workspace_id, created_at desc);

alter table public.leads enable row level security;

drop policy if exists owner_select_leads on public.leads;
drop policy if exists owner_insert_leads on public.leads;
drop policy if exists owner_update_leads on public.leads;
drop policy if exists owner_delete_leads on public.leads;

create policy workspace_members_select_leads on public.leads for select to authenticated using (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = leads.workspace_id and wm.user_id = (select auth.uid()))
);
create policy workspace_members_insert_leads on public.leads for insert to authenticated with check (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = leads.workspace_id and wm.user_id = (select auth.uid()))
);
create policy workspace_members_update_leads on public.leads for update to authenticated using (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = leads.workspace_id and wm.user_id = (select auth.uid()))
) with check (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = leads.workspace_id and wm.user_id = (select auth.uid()))
);
create policy workspace_admins_delete_leads on public.leads for delete to authenticated using (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = leads.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin'))
);

alter table public.lead_routing_history enable row level security;
drop policy if exists owner_select_lead_routing_history on public.lead_routing_history;
drop policy if exists owner_insert_lead_routing_history on public.lead_routing_history;
drop policy if exists owner_update_lead_routing_history on public.lead_routing_history;
create policy workspace_members_select_routing_history on public.lead_routing_history for select to authenticated using (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = lead_routing_history.workspace_id and wm.user_id = (select auth.uid()))
);
create policy workspace_members_insert_routing_history on public.lead_routing_history for insert to authenticated with check (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = lead_routing_history.workspace_id and wm.user_id = (select auth.uid()))
);
create policy workspace_members_update_routing_history on public.lead_routing_history for update to authenticated using (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = lead_routing_history.workspace_id and wm.user_id = (select auth.uid()))
) with check (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = lead_routing_history.workspace_id and wm.user_id = (select auth.uid()))
);

alter table public.insights enable row level security;
drop policy if exists owner_all_insights on public.insights;
drop policy if exists owner_select_insights on public.insights;
create policy workspace_members_select_insights on public.insights for select to authenticated using (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = insights.workspace_id and wm.user_id = (select auth.uid()))
);
create policy workspace_members_manage_insights on public.insights for all to authenticated using (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = insights.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin'))
) with check (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = insights.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin'))
);

alter table public.weekly_summary enable row level security;
drop policy if exists owner_all_weekly_summary on public.weekly_summary;
drop policy if exists owner_select_weekly_summary on public.weekly_summary;
create policy workspace_members_select_weekly_summary on public.weekly_summary for select to authenticated using (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = weekly_summary.workspace_id and wm.user_id = (select auth.uid()))
);
create policy workspace_members_manage_weekly_summary on public.weekly_summary for all to authenticated using (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = weekly_summary.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin'))
) with check (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = weekly_summary.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin'))
);

create table if not exists public.ai_interactions (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('aiq_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  conversation_id text not null,
  question text not null check (char_length(question) between 1 and 12000),
  answer text,
  model text,
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  n8n_execution_id text,
  context_snapshot jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.ai_memories (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('mem_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scope_type text not null default 'workspace' check (scope_type in ('workspace','lead','contact','company','deal')),
  scope_key text,
  memory_type text not null check (memory_type in ('fact','preference','correction','outcome','pattern')),
  content text not null check (char_length(content) between 1 and 8000),
  confidence numeric(4,3) not null default 0.700 check (confidence between 0 and 1),
  status text not null default 'candidate' check (status in ('candidate','active','superseded','rejected')),
  source_interaction_id uuid references public.ai_interactions(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  evidence_count integer not null default 1 check (evidence_count >= 1),
  embedding extensions.vector(768),
  metadata jsonb not null default '{}'::jsonb,
  times_used integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  interaction_id uuid not null references public.ai_interactions(id) on delete cascade,
  rating smallint check (rating in (-1,1)),
  correction text check (correction is null or char_length(correction) <= 8000),
  scope_type text not null default 'workspace' check (scope_type in ('workspace','lead','contact','company','deal')),
  scope_key text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (rating is not null or correction is not null)
);

create table if not exists public.ai_memory_usage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  interaction_id uuid not null references public.ai_interactions(id) on delete cascade,
  memory_id uuid not null references public.ai_memories(id) on delete cascade,
  similarity numeric(5,4),
  created_at timestamptz not null default now(),
  unique(interaction_id, memory_id)
);

create index if not exists ai_interactions_workspace_created_idx on public.ai_interactions(workspace_id, created_at desc);
create index if not exists ai_memories_workspace_status_idx on public.ai_memories(workspace_id, status, updated_at desc);
create index if not exists ai_memories_scope_idx on public.ai_memories(workspace_id, scope_type, scope_key, status);
create index if not exists ai_feedback_workspace_created_idx on public.ai_feedback(workspace_id, created_at desc);
create index if not exists ai_memory_usage_interaction_idx on public.ai_memory_usage(interaction_id, created_at desc);

alter table public.ai_interactions enable row level security;
alter table public.ai_memories enable row level security;
alter table public.ai_feedback enable row level security;
alter table public.ai_memory_usage enable row level security;

create policy workspace_members_select_ai_interactions on public.ai_interactions for select to authenticated using (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = ai_interactions.workspace_id and wm.user_id = (select auth.uid()))
);
create policy workspace_members_insert_ai_interactions on public.ai_interactions for insert to authenticated with check (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = ai_interactions.workspace_id and wm.user_id = (select auth.uid()))
);

create policy workspace_members_select_ai_memories on public.ai_memories for select to authenticated using (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = ai_memories.workspace_id and wm.user_id = (select auth.uid()))
);
create policy workspace_admins_manage_ai_memories on public.ai_memories for all to authenticated using (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = ai_memories.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin'))
) with check (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = ai_memories.workspace_id and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin'))
);

create policy workspace_members_select_ai_feedback on public.ai_feedback for select to authenticated using (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = ai_feedback.workspace_id and wm.user_id = (select auth.uid()))
);
create policy workspace_members_insert_ai_feedback on public.ai_feedback for insert to authenticated with check (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = ai_feedback.workspace_id and wm.user_id = (select auth.uid()))
);

create policy workspace_members_select_ai_memory_usage on public.ai_memory_usage for select to authenticated using (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = ai_memory_usage.workspace_id and wm.user_id = (select auth.uid()))
);

create or replace function private.promote_ai_feedback_correction()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.correction is not null and btrim(new.correction) <> '' then
    insert into public.ai_memories (
      workspace_id, scope_type, scope_key, memory_type, content, confidence, status, source_interaction_id, created_by, metadata
    ) values (
      new.workspace_id, new.scope_type, new.scope_key, 'correction', btrim(new.correction), 1.000, 'active', new.interaction_id, new.created_by,
      jsonb_build_object('source','explicit_user_correction','feedback_id',new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_promote_ai_feedback_correction on public.ai_feedback;
create trigger trg_promote_ai_feedback_correction
after insert on public.ai_feedback
for each row execute function private.promote_ai_feedback_correction();

create or replace function public.match_ai_memories(
  p_workspace_id uuid,
  p_query_embedding extensions.vector(768),
  p_match_count integer default 8,
  p_scope_type text default null,
  p_scope_key text default null
)
returns table (
  id uuid,
  public_id text,
  content text,
  memory_type text,
  scope_type text,
  scope_key text,
  confidence numeric,
  similarity float
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    m.id,
    m.public_id,
    m.content,
    m.memory_type,
    m.scope_type,
    m.scope_key,
    m.confidence,
    1 - (m.embedding <=> p_query_embedding) as similarity
  from public.ai_memories m
  where m.workspace_id = p_workspace_id
    and m.status = 'active'
    and m.embedding is not null
    and (p_scope_type is null or m.scope_type in ('workspace', p_scope_type))
    and (p_scope_key is null or m.scope_key is null or m.scope_key = p_scope_key)
  order by m.embedding <=> p_query_embedding, m.confidence desc, m.updated_at desc
  limit least(greatest(p_match_count, 1), 50);
$$;

revoke all on function public.match_ai_memories(uuid, extensions.vector, integer, text, text) from public;
grant execute on function public.match_ai_memories(uuid, extensions.vector, integer, text, text) to service_role;;
