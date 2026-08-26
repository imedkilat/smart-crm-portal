alter table public.leads
  add column if not exists public_id text,
  add column if not exists workspace_id uuid;

update public.leads
set public_id = 'ld_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
where public_id is null;

alter table public.leads
  alter column public_id set default ('ld_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  alter column public_id set not null;

create unique index if not exists leads_public_id_key on public.leads(public_id);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  public_id text not null default ('ws_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  name text not null,
  slug text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_public_id_key unique (public_id),
  constraint workspaces_slug_key unique (slug),
  constraint workspaces_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_id_idx on public.workspace_members(user_id);
create index if not exists leads_workspace_id_idx on public.leads(workspace_id);

alter table public.leads
  add constraint leads_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete set null;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;

create policy "workspace_creator_select"
on public.workspaces for select
to authenticated
using ((select auth.uid()) = created_by);

create policy "workspace_creator_insert"
on public.workspaces for insert
to authenticated
with check ((select auth.uid()) = created_by);

create policy "workspace_creator_update"
on public.workspaces for update
to authenticated
using ((select auth.uid()) = created_by)
with check ((select auth.uid()) = created_by);

create policy "workspace_creator_delete"
on public.workspaces for delete
to authenticated
using ((select auth.uid()) = created_by);

create policy "workspace_member_select"
on public.workspace_members for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.workspaces w
    where w.id = workspace_members.workspace_id
      and w.created_by = (select auth.uid())
  )
);

create policy "workspace_creator_manage_members_insert"
on public.workspace_members for insert
to authenticated
with check (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_members.workspace_id
      and w.created_by = (select auth.uid())
  )
);

create policy "workspace_creator_manage_members_update"
on public.workspace_members for update
to authenticated
using (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_members.workspace_id
      and w.created_by = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_members.workspace_id
      and w.created_by = (select auth.uid())
  )
);

create policy "workspace_creator_manage_members_delete"
on public.workspace_members for delete
to authenticated
using (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_members.workspace_id
      and w.created_by = (select auth.uid())
  )
);

with owner_user as (
  select id from auth.users where raw_app_meta_data ->> 'role' = 'owner' order by created_at asc limit 1
), inserted_workspace as (
  insert into public.workspaces (name, slug, created_by)
  select 'My Workspace', 'my-workspace', id from owner_user
  where not exists (select 1 from public.workspaces where slug = 'my-workspace')
  returning id, created_by
), workspace_row as (
  select id, created_by from inserted_workspace
  union all
  select w.id, w.created_by from public.workspaces w where w.slug = 'my-workspace' limit 1
)
insert into public.workspace_members (workspace_id, user_id, role)
select id, created_by, 'owner' from workspace_row
on conflict (workspace_id, user_id) do nothing;

update public.leads l
set workspace_id = w.id
from public.workspaces w
where l.workspace_id is null
  and w.slug = 'my-workspace';;
