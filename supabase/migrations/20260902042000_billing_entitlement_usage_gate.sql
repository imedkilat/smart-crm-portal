-- Billing P0-1: authoritative entitlement and usage enforcement.
--
-- This migration intentionally does NOT configure Stripe or enable charges.
-- It makes the existing local subscription state authoritative for feature
-- access and monthly usage before any payment provider is introduced.

alter table public.plans
  add column if not exists entitlements jsonb not null default '{}'::jsonb;

comment on column public.plans.entitlements is
  'Machine-readable feature entitlements. Human-facing features remain in plans.features.';

update public.plans
set entitlements = entitlements || case code
  when 'free' then pg_catalog.jsonb_build_object(
    'lead_intake', true,
    'ai_copilot', true,
    'follow_up_automation', false,
    'outbound_email', false
  )
  when 'starter' then pg_catalog.jsonb_build_object(
    'lead_intake', true,
    'ai_copilot', true,
    'follow_up_automation', true,
    'outbound_email', true
  )
  when 'pro' then pg_catalog.jsonb_build_object(
    'lead_intake', true,
    'ai_copilot', true,
    'follow_up_automation', true,
    'outbound_email', true
  )
  when 'white_label' then pg_catalog.jsonb_build_object(
    'lead_intake', true,
    'ai_copilot', true,
    'follow_up_automation', true,
    'outbound_email', true
  )
  else '{}'::jsonb
end
where code in ('free', 'starter', 'pro', 'white_label');

-- Legacy workspaces created before the billing foundation must not become
-- unusable when fail-closed entitlement checks are introduced. Attach Free only
-- when no subscription exists; never overwrite an existing paid/custom row.
insert into public.subscriptions (
  workspace_id,
  plan_id,
  status,
  billing_cycle,
  deployment_type,
  current_period_start
)
select
  w.id,
  p.id,
  'active',
  'none',
  'hosted',
  pg_catalog.now()
from public.workspaces w
join public.plans p
  on p.code = 'free'
 and p.is_active = true
left join public.subscriptions s
  on s.workspace_id = w.id
where s.id is null
on conflict (workspace_id) do nothing;

-- Seed the current calendar-month counters from durable source tables so the
-- new gate starts from real usage instead of zero. Never reduce an existing
-- counter if an environment already has higher metered usage.
insert into public.usage_counters (
  workspace_id,
  metric,
  period_start,
  period_end,
  count
)
select
  l.workspace_id,
  'leads_created',
  pg_catalog.date_trunc('month', pg_catalog.now())::date,
  (pg_catalog.date_trunc('month', pg_catalog.now()) + interval '1 month')::date,
  pg_catalog.count(*)::integer
from public.leads l
where l.workspace_id is not null
  and l.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
  and l.created_at < pg_catalog.date_trunc('month', pg_catalog.now()) + interval '1 month'
group by l.workspace_id
on conflict (workspace_id, metric, period_start) do update
set
  count = greatest(public.usage_counters.count, excluded.count),
  period_end = excluded.period_end,
  updated_at = pg_catalog.now();

insert into public.usage_counters (
  workspace_id,
  metric,
  period_start,
  period_end,
  count
)
select
  ai.workspace_id,
  'ai_interactions',
  pg_catalog.date_trunc('month', pg_catalog.now())::date,
  (pg_catalog.date_trunc('month', pg_catalog.now()) + interval '1 month')::date,
  pg_catalog.count(*)::integer
from public.ai_interactions ai
where ai.workspace_id is not null
  and ai.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
  and ai.created_at < pg_catalog.date_trunc('month', pg_catalog.now()) + interval '1 month'
group by ai.workspace_id
on conflict (workspace_id, metric, period_start) do update
set
  count = greatest(public.usage_counters.count, excluded.count),
  period_end = excluded.period_end,
  updated_at = pg_catalog.now();

create or replace function public.check_workspace_entitlement(
  p_workspace_id uuid,
  p_entitlement_key text
)
returns table (
  allowed boolean,
  reason text,
  plan_code text,
  subscription_status text,
  entitlement_enabled boolean,
  limit_value integer,
  used_value integer,
  remaining_value integer,
  period_start date,
  period_end date
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_entitlement_key, '')));
  v_plan_code text;
  v_subscription_status text;
  v_plan_active boolean;
  v_entitlement_enabled boolean := false;
  v_metric text;
  v_limit integer;
  v_used integer := 0;
  v_period_start date := pg_catalog.date_trunc('month', pg_catalog.now())::date;
  v_period_end date := (pg_catalog.date_trunc('month', pg_catalog.now()) + interval '1 month')::date;
begin
  if p_workspace_id is null then
    raise exception 'workspace_id is required' using errcode = '22023';
  end if;

  if v_key !~ '^[a-z][a-z0-9_]{1,63}$' then
    raise exception 'Invalid entitlement key' using errcode = '22023';
  end if;

  select
    p.code,
    s.status,
    p.is_active,
    coalesce(p.entitlements @> pg_catalog.jsonb_build_object(v_key, true), false),
    case v_key
      when 'lead_intake' then 'leads_created'
      when 'ai_copilot' then 'ai_interactions'
      else null
    end,
    case v_key
      when 'lead_intake' then p.max_leads_per_month
      when 'ai_copilot' then p.max_ai_interactions_per_month
      else null
    end
  into
    v_plan_code,
    v_subscription_status,
    v_plan_active,
    v_entitlement_enabled,
    v_metric,
    v_limit
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.workspace_id = p_workspace_id;

  if v_plan_code is null then
    return query select
      false, 'subscription_missing'::text, null::text, null::text,
      false, null::integer, 0, null::integer, v_period_start, v_period_end;
    return;
  end if;

  if v_metric is not null then
    select coalesce(uc.count, 0)
    into v_used
    from public.usage_counters uc
    where uc.workspace_id = p_workspace_id
      and uc.metric = v_metric
      and uc.period_start = v_period_start;

    v_used := coalesce(v_used, 0);
  end if;

  if v_plan_active is not true then
    return query select
      false, 'plan_inactive'::text, v_plan_code, v_subscription_status,
      v_entitlement_enabled, v_limit, v_used,
      case when v_limit is null then null else greatest(v_limit - v_used, 0) end,
      v_period_start, v_period_end;
    return;
  end if;

  if v_subscription_status not in ('trialing', 'active') then
    return query select
      false, 'subscription_inactive'::text, v_plan_code, v_subscription_status,
      v_entitlement_enabled, v_limit, v_used,
      case when v_limit is null then null else greatest(v_limit - v_used, 0) end,
      v_period_start, v_period_end;
    return;
  end if;

  if v_entitlement_enabled is not true then
    return query select
      false, 'entitlement_disabled'::text, v_plan_code, v_subscription_status,
      false, v_limit, v_used,
      case when v_limit is null then null else greatest(v_limit - v_used, 0) end,
      v_period_start, v_period_end;
    return;
  end if;

  if v_limit is not null and v_used >= v_limit then
    return query select
      false, 'quota_exhausted'::text, v_plan_code, v_subscription_status,
      true, v_limit, v_used, 0, v_period_start, v_period_end;
    return;
  end if;

  return query select
    true, 'allowed'::text, v_plan_code, v_subscription_status,
    true, v_limit, v_used,
    case when v_limit is null then null else greatest(v_limit - v_used, 0) end,
    v_period_start, v_period_end;
end;
$$;

revoke all on function public.check_workspace_entitlement(uuid, text)
  from public, anon, authenticated;
grant execute on function public.check_workspace_entitlement(uuid, text)
  to service_role;

comment on function public.check_workspace_entitlement(uuid, text) is
  'Service-role-only preflight for subscription status, machine entitlement, and current monthly quota. Read-only; database triggers remain the authoritative quota consumer.';

create or replace function private.assert_workspace_entitlement(
  p_workspace_id uuid,
  p_entitlement_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate record;
begin
  select *
  into v_gate
  from public.check_workspace_entitlement(p_workspace_id, p_entitlement_key);

  if v_gate.allowed is not true then
    raise exception 'Workspace entitlement denied: %', v_gate.reason
      using errcode = 'P0001',
            detail = pg_catalog.format(
              'entitlement=%s plan=%s subscription_status=%s',
              p_entitlement_key,
              coalesce(v_gate.plan_code, 'none'),
              coalesce(v_gate.subscription_status, 'none')
            );
  end if;
end;
$$;

create or replace function private.consume_workspace_monthly_quota(
  p_workspace_id uuid,
  p_entitlement_key text,
  p_metric text,
  p_units integer default 1
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate record;
  v_period_start date := pg_catalog.date_trunc('month', pg_catalog.now())::date;
  v_period_end date := (pg_catalog.date_trunc('month', pg_catalog.now()) + interval '1 month')::date;
begin
  if p_units is null or p_units < 1 or p_units > 10000 then
    raise exception 'Invalid quota unit count' using errcode = '22023';
  end if;

  if p_metric not in ('leads_created', 'ai_interactions') then
    raise exception 'Unsupported billable metric' using errcode = '22023';
  end if;

  -- Serialize quota consumers for the same workspace/metric/month. This keeps
  -- the check + increment atomic even when several requests arrive together.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_workspace_id::text || ':' || p_metric || ':' || v_period_start::text,
      902
    )
  );

  select *
  into v_gate
  from public.check_workspace_entitlement(p_workspace_id, p_entitlement_key);

  if v_gate.allowed is not true then
    raise exception 'Workspace quota denied: %', v_gate.reason
      using errcode = 'P0001',
            detail = pg_catalog.format(
              'entitlement=%s metric=%s plan=%s used=%s limit=%s',
              p_entitlement_key,
              p_metric,
              coalesce(v_gate.plan_code, 'none'),
              coalesce(v_gate.used_value::text, '0'),
              coalesce(v_gate.limit_value::text, 'unlimited')
            );
  end if;

  if v_gate.limit_value is not null
     and v_gate.used_value + p_units > v_gate.limit_value then
    raise exception 'Workspace quota exceeded'
      using errcode = 'P0001',
            detail = pg_catalog.format(
              'entitlement=%s metric=%s used=%s requested=%s limit=%s',
              p_entitlement_key,
              p_metric,
              v_gate.used_value,
              p_units,
              v_gate.limit_value
            );
  end if;

  -- NULL limit means intentionally unlimited (for example custom/white-label).
  -- Still meter it so usage remains observable.
  insert into public.usage_counters (
    workspace_id,
    metric,
    period_start,
    period_end,
    count
  )
  values (
    p_workspace_id,
    p_metric,
    v_period_start,
    v_period_end,
    p_units
  )
  on conflict (workspace_id, metric, period_start) do update
  set
    count = public.usage_counters.count + excluded.count,
    period_end = excluded.period_end,
    updated_at = pg_catalog.now();
end;
$$;

revoke all on function private.assert_workspace_entitlement(uuid, text)
  from public, anon, authenticated;
revoke all on function private.consume_workspace_monthly_quota(uuid, text, text, integer)
  from public, anon, authenticated;

create or replace function private.enforce_lead_creation_billing_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.workspace_id is null then
    raise exception 'workspace_id is required for lead creation' using errcode = '23502';
  end if;

  perform private.consume_workspace_monthly_quota(
    new.workspace_id,
    'lead_intake',
    'leads_created',
    1
  );
  return new;
end;
$$;

create or replace function private.enforce_ai_interaction_billing_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.consume_workspace_monthly_quota(
    new.workspace_id,
    'ai_copilot',
    'ai_interactions',
    1
  );
  return new;
end;
$$;

create or replace function private.enforce_follow_up_task_billing_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.automation_key, '') like 'follow-up:%'
     or coalesce(new.description, '') like '%[AUTO-FOLLOW-UP:%' then
    perform private.assert_workspace_entitlement(
      new.workspace_id,
      'follow_up_automation'
    );
  end if;
  return new;
end;
$$;

create or replace function private.enforce_outbound_email_billing_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_workspace_entitlement(
    new.workspace_id,
    'outbound_email'
  );
  return new;
end;
$$;

drop trigger if exists trg_leads_billing_gate on public.leads;
create trigger trg_leads_billing_gate
before insert on public.leads
for each row execute function private.enforce_lead_creation_billing_gate();

drop trigger if exists trg_ai_interactions_billing_gate on public.ai_interactions;
create trigger trg_ai_interactions_billing_gate
before insert on public.ai_interactions
for each row execute function private.enforce_ai_interaction_billing_gate();

drop trigger if exists trg_follow_up_tasks_billing_gate on public.lead_tasks;
create trigger trg_follow_up_tasks_billing_gate
before insert on public.lead_tasks
for each row execute function private.enforce_follow_up_task_billing_gate();

drop trigger if exists trg_outbound_email_billing_gate on public.outbound_email_deliveries;
create trigger trg_outbound_email_billing_gate
before insert on public.outbound_email_deliveries
for each row execute function private.enforce_outbound_email_billing_gate();

comment on trigger trg_leads_billing_gate on public.leads is
  'Atomically enforces lead-intake entitlement and monthly lead quota on every durable lead insert, including bulk imports.';
comment on trigger trg_ai_interactions_billing_gate on public.ai_interactions is
  'Atomically enforces AI entitlement and monthly AI quota when an interaction becomes durable.';
comment on trigger trg_follow_up_tasks_billing_gate on public.lead_tasks is
  'Blocks automated follow-up task creation when the workspace plan is not entitled.';
comment on trigger trg_outbound_email_billing_gate on public.outbound_email_deliveries is
  'Blocks outbound email preparation when the workspace plan is not entitled, before any provider send can occur.';
