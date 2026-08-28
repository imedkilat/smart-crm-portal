-- Fix PL/pgSQL ambiguity between the RETURNS TABLE workspace_id output
-- variable and public.subscriptions.workspace_id in the onboarding UPSERT.
--
-- Production symptom:
--   column reference "workspace_id" is ambiguous
--
-- The unique constraint name is explicit so PostgreSQL does not need to
-- resolve the ambiguous workspace_id identifier inside the function body.

do $hotfix$
declare
  v_def text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.ensure_workspace_onboarding(text)'::pg_catalog.regprocedure
  )
  into v_def;

  if pg_catalog.strpos(
    v_def,
    'on conflict on constraint subscriptions_workspace_id_key do nothing;'
  ) > 0 then
    null;
  elsif pg_catalog.strpos(v_def, 'on conflict (workspace_id) do nothing;') > 0 then
    v_def := pg_catalog.replace(
      v_def,
      'on conflict (workspace_id) do nothing;',
      'on conflict on constraint subscriptions_workspace_id_key do nothing;'
    );

    execute v_def;
  else
    raise exception 'Expected onboarding subscription conflict clause was not found; migration aborted';
  end if;
end
$hotfix$;

-- Re-assert the intended RPC execution boundary after replacing the function.
revoke all on function public.ensure_workspace_onboarding(text) from public;
revoke all on function public.ensure_workspace_onboarding(text) from anon;
grant execute on function public.ensure_workspace_onboarding(text) to authenticated, service_role;
