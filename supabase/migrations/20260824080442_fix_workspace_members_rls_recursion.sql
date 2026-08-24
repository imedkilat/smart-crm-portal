create or replace function private.is_workspace_creator(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.workspaces w
      where w.id = p_workspace_id
        and w.created_by = (select auth.uid())
    );
$$;

revoke all on function private.is_workspace_creator(uuid) from public;
grant execute on function private.is_workspace_creator(uuid) to authenticated, service_role;

drop policy if exists workspace_member_select on public.workspace_members;

create policy workspace_member_select
on public.workspace_members
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_workspace_creator(workspace_id))
);
