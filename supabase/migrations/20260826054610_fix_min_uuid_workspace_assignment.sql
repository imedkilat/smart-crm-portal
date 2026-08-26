-- 20260826054610_fix_min_uuid_workspace_assignment.sql
-- ============================================================================
-- FIX: "function min(uuid) does not exist"
-- ============================================================================
-- public.workspaces.id is uuid, which has no min() aggregate. Two trigger
-- functions used `select count(*), min(id) from public.workspaces` to find the
-- sole workspace, which aborts the n8n Save-to-Supabase (leads) insert.
--
-- uuid HAS ordering operators (order by id works); only the aggregate is missing.
-- Replace `min(id)` with `(select id from public.workspaces order by id limit 1)`
-- — a value-identical result (same total order min() would use), still one row,
-- so the SELECT ... INTO (workspace_count, sole_workspace) semantics are unchanged.
--
-- Everything else is preserved verbatim from the live definitions (project
-- updpvuhtsqhpaylegrbz): schema, LANGUAGE plpgsql, RETURNS trigger, SECURITY
-- DEFINER/INVOKER, search_path, guard clauses, exception behavior. ONLY the
-- aggregation expression changes. No RLS policies are touched. Idempotent via
-- CREATE OR REPLACE (ownership and grants are retained).
-- ============================================================================
-- Note: no explicit BEGIN/COMMIT here — the Supabase migration runner wraps and
-- records execution. This file contains only the two CREATE OR REPLACE FUNCTION
-- statements (idempotent). RLS policies are not touched.

-- 1) public.assign_single_workspace_to_lead()  (SECURITY INVOKER, search_path=public)
CREATE OR REPLACE FUNCTION public.assign_single_workspace_to_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  workspace_count integer;
  sole_workspace uuid;
begin
  if new.workspace_id is not null then
    return new;
  end if;

  select count(*), (select w.id from public.workspaces w order by w.id limit 1)
  into workspace_count, sole_workspace
  from public.workspaces;

  if workspace_count = 1 then
    new.workspace_id := sole_workspace;
  end if;

  return new;
end;
$function$;

-- 2) private.assign_single_workspace_to_legacy_report()  (SECURITY DEFINER, search_path=public,private)
CREATE OR REPLACE FUNCTION private.assign_single_workspace_to_legacy_report()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  workspace_count integer;
  sole_workspace uuid;
begin
  if new.workspace_id is not null then return new; end if;

  select count(*), (select w.id from public.workspaces w order by w.id limit 1)
  into workspace_count, sole_workspace
  from public.workspaces;

  if workspace_count = 1 then
    new.workspace_id := sole_workspace;
  end if;

  if new.workspace_id is null then
    raise exception 'workspace_id is required once multiple workspaces exist';
  end if;

  return new;
end;
$function$;
