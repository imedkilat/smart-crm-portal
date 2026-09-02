-- Authoritative task counts for a workspace, independent of any UI/API page-size cap.
-- Used by the AI Brain Copilot so it never treats a capped detail list (e.g. 100 rows)
-- as the true total when reasoning about "how many tasks" questions.
create or replace function public.get_workspace_task_counts(p_workspace_id uuid)
returns table(total bigint, open bigint, done bigint, overdue bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*) as total,
    count(*) filter (where t.status <> 'done') as open,
    count(*) filter (where t.status = 'done') as done,
    count(*) filter (where t.status <> 'done' and t.due_at is not null and t.due_at < now()) as overdue
  from public.lead_tasks t
  where t.workspace_id = p_workspace_id;
$$;

comment on function public.get_workspace_task_counts(uuid) is 'Authoritative total/open/done/overdue task counts for a workspace, used by the AI Copilot to avoid mistaking a capped 100-row task list for the true total.';

revoke all on function public.get_workspace_task_counts(uuid) from public;
revoke execute on function public.get_workspace_task_counts(uuid) from anon;
grant execute on function public.get_workspace_task_counts(uuid) to authenticated, service_role;
