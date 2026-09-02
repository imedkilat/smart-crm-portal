-- Harden workspace task-count reads against cross-tenant access.
--
-- The RPC previously ran as its postgres owner, bypassing lead_tasks RLS.
-- SECURITY INVOKER preserves the existing count query while enforcing the
-- caller's table grants and workspace_members_read_tasks RLS policy.

alter function public.get_workspace_task_counts(uuid)
  security invoker;

revoke execute
  on function public.get_workspace_task_counts(uuid)
  from public, anon;

grant execute
  on function public.get_workspace_task_counts(uuid)
  to authenticated, service_role;

comment on function public.get_workspace_task_counts(uuid) is
  'Returns task totals for a workspace. Runs as the caller so lead_tasks RLS enforces tenant isolation.';
