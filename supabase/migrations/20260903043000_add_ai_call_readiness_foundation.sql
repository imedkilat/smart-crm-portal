-- AI Call Qualifier V0 call-readiness foundation.
--
-- This migration intentionally does NOT enable any outbound calling.
-- It only establishes the CRM data contract needed before a provider can be
-- wired safely:
--   1. canonical E.164 lead phone
--   2. canonical assigned rep / lead owner with same-workspace enforcement
--   3. private per-workspace rep warm-transfer profile
--   4. safe member directory RPC that never exposes transfer phone numbers

alter table public.leads
  add column phone_e164 text,
  add column owner_user_id uuid;

alter table public.leads
  add constraint leads_phone_e164_check
    check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  add constraint leads_owner_user_id_fkey
    foreign key (owner_user_id)
    references auth.users(id)
    on delete set null;

create index leads_workspace_owner_idx
  on public.leads (workspace_id, owner_user_id)
  where owner_user_id is not null;

create or replace function private.guard_lead_owner_workspace_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_user_id is null then
    return new;
  end if;

  if new.workspace_id is null then
    raise exception 'Lead must belong to a workspace before assigning an owner'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = new.owner_user_id
  ) then
    raise exception 'Lead owner must be a member of the same workspace'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_lead_owner_workspace_membership() from public;
revoke all on function private.guard_lead_owner_workspace_membership() from anon;
revoke all on function private.guard_lead_owner_workspace_membership() from authenticated;
grant execute on function private.guard_lead_owner_workspace_membership() to service_role;

drop trigger if exists trg_guard_lead_owner_workspace_membership on public.leads;
create trigger trg_guard_lead_owner_workspace_membership
before insert or update of workspace_id, owner_user_id on public.leads
for each row
execute function private.guard_lead_owner_workspace_membership();

create table public.workspace_member_call_profiles (
  workspace_id uuid not null,
  user_id uuid not null,
  warm_transfer_phone_e164 text,
  accepts_warm_transfers boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint workspace_member_call_profiles_member_fkey
    foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id)
    on delete cascade,
  constraint workspace_member_call_profiles_phone_e164_check
    check (
      warm_transfer_phone_e164 is null
      or warm_transfer_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
    ),
  constraint workspace_member_call_profiles_enabled_requires_phone_check
    check (
      accepts_warm_transfers is false
      or warm_transfer_phone_e164 is not null
    )
);

alter table public.workspace_member_call_profiles enable row level security;

grant select, insert, update, delete
  on public.workspace_member_call_profiles
  to authenticated;
grant all
  on public.workspace_member_call_profiles
  to service_role;

create policy workspace_member_call_profiles_select
on public.workspace_member_call_profiles
for select
to authenticated
using (
  (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
  )
  or private.is_workspace_member(workspace_id, array['owner', 'admin']::text[])
);

create policy workspace_member_call_profiles_insert
on public.workspace_member_call_profiles
for insert
to authenticated
with check (
  (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
  )
  or private.is_workspace_member(workspace_id, array['owner', 'admin']::text[])
);

create policy workspace_member_call_profiles_update
on public.workspace_member_call_profiles
for update
to authenticated
using (
  (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
  )
  or private.is_workspace_member(workspace_id, array['owner', 'admin']::text[])
)
with check (
  (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
  )
  or private.is_workspace_member(workspace_id, array['owner', 'admin']::text[])
);

create policy workspace_member_call_profiles_delete
on public.workspace_member_call_profiles
for delete
to authenticated
using (
  (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
  )
  or private.is_workspace_member(workspace_id, array['owner', 'admin']::text[])
);

drop trigger if exists trg_workspace_member_call_profiles_updated_at
  on public.workspace_member_call_profiles;
create trigger trg_workspace_member_call_profiles_updated_at
before update on public.workspace_member_call_profiles
for each row
execute function private.set_updated_at();

create or replace function public.list_workspace_member_directory(p_workspace_id uuid)
returns table (
  user_id uuid,
  role text,
  display_name text,
  call_ready boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not private.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace membership required' using errcode = '42501';
  end if;

  return query
  select
    wm.user_id,
    wm.role,
    coalesce(
      nullif(pg_catalog.btrim(au.raw_user_meta_data ->> 'display_name'), ''),
      nullif(pg_catalog.btrim(au.raw_user_meta_data ->> 'full_name'), ''),
      nullif(pg_catalog.btrim(au.raw_user_meta_data ->> 'name'), ''),
      'Workspace member'
    )::text as display_name,
    coalesce(
      cp.accepts_warm_transfers
      and cp.warm_transfer_phone_e164 is not null,
      false
    ) as call_ready
  from public.workspace_members wm
  join auth.users au
    on au.id = wm.user_id
  left join public.workspace_member_call_profiles cp
    on cp.workspace_id = wm.workspace_id
   and cp.user_id = wm.user_id
  where wm.workspace_id = p_workspace_id
  order by
    case wm.role when 'owner' then 0 when 'admin' then 1 else 2 end,
    display_name,
    wm.user_id;
end;
$$;

revoke all on function public.list_workspace_member_directory(uuid) from public;
revoke all on function public.list_workspace_member_directory(uuid) from anon;
grant execute on function public.list_workspace_member_directory(uuid) to authenticated;
grant execute on function public.list_workspace_member_directory(uuid) to service_role;
