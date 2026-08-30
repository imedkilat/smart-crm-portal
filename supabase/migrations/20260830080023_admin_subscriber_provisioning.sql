-- Admin-managed subscriber provisioning for manually invoiced customers.
--
-- The invitation itself is sent by the admin-provision-subscriber Edge
-- Function. This migration stores a short-lived, auditable entitlement request
-- and lets the existing authenticated onboarding RPC claim it by verified Auth
-- email. No browser is allowed to write subscriptions or provisioning rows.

create table if not exists public.subscriber_provisioning_requests (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default (
    'spr_' || pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 16)
  ),
  email text not null check (
    email = pg_catalog.lower(pg_catalog.btrim(email))
    and pg_catalog.char_length(email) between 3 and 320
  ),
  workspace_name text not null check (pg_catalog.char_length(workspace_name) between 2 and 100),
  plan_id uuid not null references public.plans(id),
  billing_cycle text not null default 'monthly'
    check (billing_cycle in ('monthly', 'annual', 'custom', 'none')),
  deployment_type text not null default 'hosted'
    check (deployment_type in ('hosted', 'white_label')),
  status text not null default 'pending'
    check (status in ('pending', 'invited', 'claimed', 'cancelled', 'expired')),
  invited_by uuid references auth.users(id) on delete set null,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_workspace_id uuid references public.workspaces(id) on delete set null,
  invited_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null default (pg_catalog.now() + interval '7 days'),
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

comment on table public.subscriber_provisioning_requests is
  'Server-managed invitations that bind a verified Auth email to one workspace and plan entitlement. Direct browser access is denied.';

create unique index if not exists subscriber_provisioning_one_pending_email_idx
  on public.subscriber_provisioning_requests (email)
  where status in ('pending', 'invited');

create index if not exists subscriber_provisioning_status_expiry_idx
  on public.subscriber_provisioning_requests (status, expires_at);

drop trigger if exists trg_subscriber_provisioning_updated_at
  on public.subscriber_provisioning_requests;
create trigger trg_subscriber_provisioning_updated_at
before update on public.subscriber_provisioning_requests
for each row execute function private.set_updated_at();

alter table public.subscriber_provisioning_requests enable row level security;

-- RLS stays enabled with no anon/authenticated policies. The Edge Function uses
-- service_role and the onboarding SECURITY DEFINER function performs the only
-- end-user claim path.
revoke all on table public.subscriber_provisioning_requests from public, anon, authenticated;
grant select, insert, update on table public.subscriber_provisioning_requests to service_role;

create or replace function public.create_subscriber_provisioning_request(
  p_email text,
  p_workspace_name text,
  p_plan_code text,
  p_billing_cycle text default 'monthly',
  p_deployment_type text default 'hosted',
  p_invited_by uuid default null
)
returns table (
  request_id uuid,
  request_public_id text,
  normalized_email text,
  plan_code text,
  request_status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_workspace_name text := pg_catalog.btrim(coalesce(p_workspace_name, ''));
  v_plan_code text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_plan_code, '')));
  v_billing_cycle text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_billing_cycle, '')));
  v_deployment_type text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_deployment_type, '')));
  v_plan_id uuid;
  v_request public.subscriber_provisioning_requests%rowtype;
begin
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or pg_catalog.char_length(v_email) > 320 then
    raise exception 'A valid subscriber email is required' using errcode = '22023';
  end if;

  if pg_catalog.char_length(v_workspace_name) not between 2 and 100 then
    raise exception 'Workspace name must be 2 to 100 characters' using errcode = '22023';
  end if;

  if v_billing_cycle not in ('monthly', 'annual', 'custom', 'none') then
    raise exception 'Unsupported billing cycle' using errcode = '22023';
  end if;

  if v_deployment_type not in ('hosted', 'white_label') then
    raise exception 'Unsupported deployment type' using errcode = '22023';
  end if;

  if v_plan_code = 'white_label' then
    v_deployment_type := 'white_label';
    v_billing_cycle := 'custom';
  elsif v_plan_code = 'free' then
    v_billing_cycle := 'none';
  end if;

  select p.id
  into v_plan_id
  from public.plans p
  where p.code = v_plan_code
    and p.is_active = true;

  if v_plan_id is null then
    raise exception 'Requested plan is not active' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_email, 744)
  );

  update public.subscriber_provisioning_requests r
  set status = 'expired'
  where r.email = v_email
    and r.status in ('pending', 'invited')
    and r.expires_at <= pg_catalog.now();

  select r.*
  into v_request
  from public.subscriber_provisioning_requests r
  where r.email = v_email
    and r.status in ('pending', 'invited')
  for update;

  if v_request.id is null then
    insert into public.subscriber_provisioning_requests (
      email,
      workspace_name,
      plan_id,
      billing_cycle,
      deployment_type,
      invited_by
    )
    values (
      v_email,
      v_workspace_name,
      v_plan_id,
      v_billing_cycle,
      v_deployment_type,
      p_invited_by
    )
    returning * into v_request;
  else
    update public.subscriber_provisioning_requests r
    set
      workspace_name = v_workspace_name,
      plan_id = v_plan_id,
      billing_cycle = v_billing_cycle,
      deployment_type = v_deployment_type,
      invited_by = p_invited_by,
      invited_at = pg_catalog.now(),
      expires_at = pg_catalog.now() + interval '7 days',
      last_error = null
    where r.id = v_request.id
    returning * into v_request;
  end if;

  insert into public.billing_events (
    event_type,
    payload,
    processed_at
  )
  values (
    'manual_provisioning.requested',
    pg_catalog.jsonb_build_object(
      'request_public_id', v_request.public_id,
      'email', v_request.email,
      'plan_code', v_plan_code,
      'invited_by', p_invited_by
    ),
    pg_catalog.now()
  );

  return query
  select
    v_request.id,
    v_request.public_id,
    v_request.email,
    v_plan_code,
    v_request.status,
    v_request.expires_at;
end;
$$;

revoke all on function public.create_subscriber_provisioning_request(text, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_subscriber_provisioning_request(text, text, text, text, text, uuid)
  to service_role;

comment on function public.create_subscriber_provisioning_request(text, text, text, text, text, uuid) is
  'Creates or refreshes one pending subscriber entitlement. Service-role only; the Edge Function separately verifies platform admin app_metadata and sends the Auth invite.';

-- Extend first-session onboarding so an invited customer receives the exact
-- server-approved plan. Self-signups continue to receive Free. Existing
-- workspace subscriptions are never changed by this RPC.
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
  v_user_email text;
  v_workspace_id uuid;
  v_workspace_public_id text;
  v_workspace_name text;
  v_workspace_slug text;
  v_workspace_role text;
  v_requested_name text;
  v_slug_base text;
  v_pipeline_id uuid;
  v_plan_id uuid;
  v_plan_code text;
  v_billing_cycle text := 'none';
  v_deployment_type text := 'hosted';
  v_created boolean := false;
  v_provisioning public.subscriber_provisioning_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 731)
  );

  select pg_catalog.lower(u.email)
  into v_user_email
  from auth.users u
  where u.id = v_user_id;

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

  if v_workspace_id is null and v_user_email is not null then
    select r.*
    into v_provisioning
    from public.subscriber_provisioning_requests r
    where r.email = v_user_email
      and r.status in ('pending', 'invited')
      and r.expires_at > pg_catalog.now()
    order by r.created_at desc
    limit 1
    for update;
  end if;

  if v_workspace_id is null then
    v_requested_name := case
      when v_provisioning.id is not null then v_provisioning.workspace_name
      else pg_catalog.btrim(coalesce(p_workspace_name, ''))
    end;

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

  if v_created and v_provisioning.id is not null then
    v_plan_id := v_provisioning.plan_id;
    v_billing_cycle := v_provisioning.billing_cycle;
    v_deployment_type := v_provisioning.deployment_type;
  else
    select p.id
    into v_plan_id
    from public.plans p
    where p.code = 'free'
      and p.is_active = true;
  end if;

  insert into public.subscriptions (
    workspace_id,
    plan_id,
    status,
    billing_cycle,
    deployment_type,
    current_period_start
  )
  values (
    v_workspace_id,
    v_plan_id,
    'active',
    v_billing_cycle,
    v_deployment_type,
    pg_catalog.now()
  )
  on conflict on constraint subscriptions_workspace_id_key do nothing;

  select p.code
  into v_plan_code
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.workspace_id = v_workspace_id;

  if v_plan_code is null then
    raise exception 'No active subscription plan is available for workspace onboarding';
  end if;

  if v_created and v_provisioning.id is not null then
    update public.subscriber_provisioning_requests r
    set
      status = 'claimed',
      claimed_by = v_user_id,
      claimed_workspace_id = v_workspace_id,
      claimed_at = pg_catalog.now()
    where r.id = v_provisioning.id;

    insert into public.billing_events (
      workspace_id,
      event_type,
      payload,
      processed_at
    )
    values (
      v_workspace_id,
      'manual_provisioning.claimed',
      pg_catalog.jsonb_build_object(
        'request_public_id', v_provisioning.public_id,
        'plan_code', v_plan_code,
        'claimed_by', v_user_id
      ),
      pg_catalog.now()
    );
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
      pg_catalog.jsonb_build_object(
        'plan_code', v_plan_code,
        'source', case when v_provisioning.id is null then 'self_signup' else 'admin_provisioning' end
      ),
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

revoke all on function public.ensure_workspace_onboarding(text) from public, anon;
grant execute on function public.ensure_workspace_onboarding(text) to authenticated, service_role;

comment on function public.ensure_workspace_onboarding(text) is
  'Idempotently resolves or creates the authenticated user workspace, claims a server-approved subscriber invitation by verified Auth email, seeds the default pipeline, and otherwise attaches Free.';