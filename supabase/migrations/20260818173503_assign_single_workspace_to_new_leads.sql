create or replace function public.assign_single_workspace_to_lead()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  workspace_count integer;
  sole_workspace uuid;
begin
  if new.workspace_id is not null then
    return new;
  end if;

  select count(*), min(id)
  into workspace_count, sole_workspace
  from public.workspaces;

  if workspace_count = 1 then
    new.workspace_id := sole_workspace;
  end if;

  return new;
end;
$$;

revoke all on function public.assign_single_workspace_to_lead() from public, anon, authenticated;

drop trigger if exists assign_single_workspace_to_lead_before_insert on public.leads;
create trigger assign_single_workspace_to_lead_before_insert
before insert on public.leads
for each row
execute function public.assign_single_workspace_to_lead();;
