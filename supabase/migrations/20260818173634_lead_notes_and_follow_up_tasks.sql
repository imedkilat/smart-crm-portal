create table if not exists public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  public_id text not null default ('note_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id bigint not null references public.leads(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_notes_public_id_key unique (public_id)
);

create index if not exists lead_notes_lead_id_created_at_idx on public.lead_notes(lead_id, created_at desc);
create index if not exists lead_notes_workspace_id_idx on public.lead_notes(workspace_id);

create table if not exists public.lead_tasks (
  id uuid primary key default gen_random_uuid(),
  public_id text not null default ('tsk_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id bigint not null references public.leads(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 240),
  description text,
  status text not null default 'open' check (status in ('open', 'done', 'canceled')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_tasks_public_id_key unique (public_id),
  constraint lead_tasks_completion_consistency check (
    (status = 'done' and completed_at is not null)
    or (status <> 'done' and completed_at is null)
  )
);

create index if not exists lead_tasks_lead_id_status_due_idx on public.lead_tasks(lead_id, status, due_at);
create index if not exists lead_tasks_workspace_id_idx on public.lead_tasks(workspace_id);
create index if not exists lead_tasks_assigned_to_idx on public.lead_tasks(assigned_to);

alter table public.lead_notes enable row level security;
alter table public.lead_tasks enable row level security;

grant select, insert, update, delete on public.lead_notes to authenticated;
grant select, insert, update, delete on public.lead_tasks to authenticated;

create policy "workspace_members_read_notes"
on public.lead_notes for select
to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = lead_notes.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy "workspace_members_insert_notes"
on public.lead_notes for insert
to authenticated
with check (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = lead_notes.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy "workspace_members_update_notes"
on public.lead_notes for update
to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = lead_notes.workspace_id
      and wm.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = lead_notes.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy "workspace_members_delete_notes"
on public.lead_notes for delete
to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = lead_notes.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy "workspace_members_read_tasks"
on public.lead_tasks for select
to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = lead_tasks.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy "workspace_members_insert_tasks"
on public.lead_tasks for insert
to authenticated
with check (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = lead_tasks.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy "workspace_members_update_tasks"
on public.lead_tasks for update
to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = lead_tasks.workspace_id
      and wm.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = lead_tasks.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy "workspace_members_delete_tasks"
on public.lead_tasks for delete
to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = lead_tasks.workspace_id
      and wm.user_id = (select auth.uid())
  )
);;
