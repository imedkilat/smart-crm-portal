create or replace function private.assign_routing_history_workspace()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.workspace_id is null then
    select l.workspace_id into new.workspace_id from public.leads l where l.id = new.lead_id;
  end if;
  if new.workspace_id is null then
    raise exception 'Could not derive workspace for routing history lead %', new.lead_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_routing_history_workspace on public.lead_routing_history;
create trigger trg_assign_routing_history_workspace
before insert on public.lead_routing_history
for each row execute function private.assign_routing_history_workspace();

create or replace function private.assign_single_workspace_to_legacy_report()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  workspace_count integer;
  sole_workspace uuid;
begin
  if new.workspace_id is not null then return new; end if;
  select count(*), min(id) into workspace_count, sole_workspace from public.workspaces;
  if workspace_count = 1 then new.workspace_id := sole_workspace; end if;
  if new.workspace_id is null then
    raise exception 'workspace_id is required once multiple workspaces exist';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_insight_workspace on public.insights;
create trigger trg_assign_insight_workspace before insert on public.insights for each row execute function private.assign_single_workspace_to_legacy_report();

drop trigger if exists trg_assign_weekly_summary_workspace on public.weekly_summary;
create trigger trg_assign_weekly_summary_workspace before insert on public.weekly_summary for each row execute function private.assign_single_workspace_to_legacy_report();

drop policy if exists workspace_creator_select on public.workspaces;
create policy workspace_member_select on public.workspaces for select to authenticated using (
  created_by = (select auth.uid()) or exists (
    select 1 from public.workspace_members wm where wm.workspace_id = workspaces.id and wm.user_id = (select auth.uid())
  )
);;
