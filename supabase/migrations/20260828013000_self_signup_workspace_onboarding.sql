-- Self-service workspace onboarding for authenticated users.
--
-- New users sign up through Supabase Auth first. On the first authenticated
-- session, the frontend calls public.ensure_workspace_onboarding(). The RPC is
-- intentionally idempotent and derives the actor from auth.uid(); it never
-- trusts a client-supplied user id, workspace id, role, or plan id.

create or replace function public.ensure_workspace_onboarding(p_workspace_name text default null)
returns table (
  workspace_id uuid,
  workspace_public_id text,
  workspace_name text,
  workspace_slug text,
  workspace_role text,
  plan_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_workspace_public_id text;
  v_workspace_name text;
  v_workspace_slug text;
  v_workspace_role text;
  v_requested_name text;
  v_slug_base text;
  v_pipeline_id uuid;
  v_plan_code text;
  v_created boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- Serialize repeated onboarding attempts for the same user. This makes the
  -- RPC safe against double-clicks, auth-event races, and refresh retries.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 731)
  );

  select
    w.id,
    w.public_id,
    w.name,
    w.slug,
    wm.role
  into
    v_workspace_id,
    v_workspace_public_id,
    v_workspace_name,
    v_workspace_slug,
    v_workspace_role
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where wm.user_id = v_user_id
  order by
    case wm.role when 'owner' then 0 when 'admin' then 1 else 2 end,
    wm.created_at asc,
    w.created_at asc
  limit 1;

  if v_workspace_id is null then
    v_requested_name := pg_catalog.btrim(coalesce(p_workspace_name, ''));

    if pg_catalog.char_length(v_requested_name) < 2 then
      raise exception 'Workspace name must be at least 2 characters' using errcode = '22023';
    end if;

    if pg_catalog.char_length(v_requested_name) > 100 then
      raise exception 'Workspace name must be 100 characters or fewer' using errcode = '22023';
    end if;

    v_slug_base := pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.lower(v_requested_name),
        '[^a-z0-9]+',
        '-',
        'g'
      ),
      '-'
    );

    if v_slug_base = '' then
      v_slug_base := 'workspace';
    end if;

    v_workspace_slug := pg_catalog.left(v_slug_base, 48)
      || '-'
      || pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 8);

    insert into public.workspaces (name, slug, created_by)
    values (v_requested_name, v_workspace_slug, v_user_id)
    returning id, public_id, name, slug
    into v_workspace_id, v_workspace_public_id, v_workspace_name, v_workspace_slug;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_workspace_id, v_user_id, 'owner');

    v_workspace_role := 'owner';
    v_created := true;
  end if;

  -- Every onboarded workspace gets one default sales pipeline. Existing
  -- workspaces are repaired idempotently if the default pipeline is missing.
  select p.id
  into v_pipeline_id
  from public.pipelines p
  where p.workspace_id = v_workspace_id
    and p.is_default = true
  order by p.created_at asc
  limit 1;

  if v_pipeline_id is null then
    insert into public.pipelines (workspace_id, name, is_default)
    values (v_workspace_id, 'Sales Pipeline', true)
    returning id into v_pipeline_id;
  end if;

  insert into public.pipeline_stages (pipeline_id, workspace_id, name, position, stage_type)
  values
    (v_pipeline_id, v_workspace_id, 'New', 10, 'open'),
    (v_pipeline_id, v_workspace_id, 'Contacted', 20, 'open'),
    (v_pipeline_id, v_workspace_id, 'Qualified', 30, 'open'),
    (v_pipeline_id, v_workspace_id, 'Proposal', 40, 'open'),
    (v_pipeline_id, v_workspace_id, 'Negotiation', 50, 'open'),
    (v_pipeline_id, v_workspace_id, 'Won', 60, 'won'),
    (v_pipeline_id, v_workspace_id, 'Lost', 70, 'lost')
  on conflict (pipeline_id, name) do nothing;

  -- Do not downgrade an existing paid/custom subscription. Only attach Free
  -- when the workspace does not yet have a subscription row.
  insert into public.subscriptions (
    workspace_id,
    plan_id,
    status,
    billing_cycle,
    deployment_type,
    current_period_start
  )
  select
    v_workspace_id,
    p.id,
    'active',
    'none',
    'hosted',
    pg_catalog.now()
  from public.plans p
  where p.code = 'free'
    and p.is_active = true
  on conflict (workspace_id) do nothing;

  select p.code
  into v_plan_code
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.workspace_id = v_workspace_id;

  if v_plan_code is null then
    raise exception 'No active subscription plan is available for workspace onboarding';
  end if;

  if v_created then
    insert into public.crm_activities (
      workspace_id,
      record_type,
      record_id,
      activity_type,
      title,
      metadata,
      actor_user_id
    )
    values (
      v_workspace_id,
      'workspace',
      v_workspace_public_id,
      'workspace_created',
      'Workspace created',
      pg_catalog.jsonb_build_object('plan_code', v_plan_code, 'source', 'self_signup'),
      v_user_id
    );
  end if;

  return query
  select
    v_workspace_id,
    v_workspace_public_id,
    v_workspace_name,
    v_workspace_slug,
    v_workspace_role,
    v_plan_code;
end;
$$;

-- SECURITY DEFINER functions are executable by PUBLIC unless explicitly
-- revoked. Keep this RPC authenticated-only and derive identity from auth.uid().
revoke all on function public.ensure_workspace_onboarding(text) from public;
revoke all on function public.ensure_workspace_onboarding(text) from anon;
grant execute on function public.ensure_workspace_onboarding(text) to authenticated, service_role;

comment on function public.ensure_workspace_onboarding(text) is
  'Idempotently resolves or creates the authenticated user workspace, seeds the default pipeline, and attaches the Free plan without trusting client-supplied authorization identifiers.';

-- Self-service workspaces must be created through the RPC so plan/workspace
-- limits cannot be bypassed with direct Data API inserts.
drop policy if exists workspace_creator_insert on public.workspaces;

-- Tighten the read policy role target. The auth.uid() predicate already kept
-- anonymous callers out, but this makes the intended boundary explicit.
drop policy if exists subscriptions_member_read on public.subscriptions;
create policy subscriptions_member_read
on public.subscriptions
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = subscriptions.workspace_id
      and wm.user_id = (select auth.uid())
  )
);
