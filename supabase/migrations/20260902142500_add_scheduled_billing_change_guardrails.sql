-- Scheduled Stripe plan/cycle change guardrails.
--
-- 1. Reserve scheduled changes atomically under the same workspace advisory lock
--    used by workspace member seat enforcement.
-- 2. While a lower-seat plan is pending, new member additions are constrained to
--    the future plan cap immediately so renewal cannot arrive over-cap.
-- 3. Reconcile a scheduled request to applied when the trusted Stripe webhook
--    updates the local subscription to the requested plan/cycle.

create or replace function public.reserve_scheduled_billing_change_request(
  p_request_id text,
  p_workspace_id uuid,
  p_requested_by uuid,
  p_from_plan_id uuid,
  p_to_plan_id uuid,
  p_from_billing_cycle text,
  p_to_billing_cycle text,
  p_stripe_subscription_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_plan_id uuid;
  v_current_status text;
  v_current_cycle text;
  v_current_provider text;
  v_current_subscription_id text;
  v_target_code text;
  v_target_active boolean;
  v_target_max_seats integer;
  v_member_count integer;
begin
  if p_request_id !~ '^bchg_[a-f0-9]{32}$' then
    raise exception 'Invalid billing change request id' using errcode = '22023';
  end if;

  if p_from_billing_cycle not in ('monthly', 'annual')
     or p_to_billing_cycle not in ('monthly', 'annual') then
    raise exception 'Invalid billing cycle' using errcode = '22023';
  end if;

  if p_stripe_subscription_id is null
     or p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$' then
    raise exception 'Invalid Stripe subscription id' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text, 1907)
  );

  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_requested_by
      and wm.role in ('owner', 'admin')
  ) then
    raise exception 'Workspace owner or administrator access required'
      using errcode = '42501';
  end if;

  select
    s.plan_id,
    s.status,
    s.billing_cycle,
    s.billing_provider,
    s.stripe_subscription_id
  into
    v_current_plan_id,
    v_current_status,
    v_current_cycle,
    v_current_provider,
    v_current_subscription_id
  from public.subscriptions s
  where s.workspace_id = p_workspace_id;

  if not found then
    raise exception 'Workspace subscription baseline is missing' using errcode = '23514';
  end if;

  if v_current_plan_id <> p_from_plan_id
     or v_current_cycle <> p_from_billing_cycle
     or v_current_provider <> 'stripe'
     or v_current_status <> 'active'
     or v_current_subscription_id <> p_stripe_subscription_id then
    raise exception 'Workspace subscription changed before the billing request could be reserved'
      using errcode = '40001';
  end if;

  select p.code, p.is_active, p.max_seats
  into v_target_code, v_target_active, v_target_max_seats
  from public.plans p
  where p.id = p_to_plan_id;

  if not found
     or v_target_active is not true
     or v_target_code not in ('starter', 'pro') then
    raise exception 'Target billing plan is unavailable' using errcode = '23514';
  end if;

  select pg_catalog.count(*)::integer
  into v_member_count
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id;

  if v_target_max_seats is not null and v_member_count > v_target_max_seats then
    raise exception 'Target plan seat limit exceeded'
      using
        errcode = '23514',
        detail = pg_catalog.format(
          'Plan %s allows at most %s workspace members; this workspace currently has %s.',
          v_target_code,
          v_target_max_seats,
          v_member_count
        );
  end if;

  insert into public.billing_change_requests (
    request_id,
    workspace_id,
    requested_by,
    from_plan_id,
    to_plan_id,
    from_billing_cycle,
    to_billing_cycle,
    mode,
    status,
    stripe_subscription_id
  ) values (
    p_request_id,
    p_workspace_id,
    p_requested_by,
    p_from_plan_id,
    p_to_plan_id,
    p_from_billing_cycle,
    p_to_billing_cycle,
    'scheduled',
    'processing',
    p_stripe_subscription_id
  );
end;
$$;

revoke all on function public.reserve_scheduled_billing_change_request(text, uuid, uuid, uuid, uuid, text, text, text) from public;
revoke all on function public.reserve_scheduled_billing_change_request(text, uuid, uuid, uuid, uuid, text, text, text) from anon;
revoke all on function public.reserve_scheduled_billing_change_request(text, uuid, uuid, uuid, uuid, text, text, text) from authenticated;
grant execute on function public.reserve_scheduled_billing_change_request(text, uuid, uuid, uuid, uuid, text, text, text) to service_role;

create or replace function private.guard_workspace_member_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_members integer := 0;
  v_max_seats integer;
  v_subscription_status text;
  v_plan_code text;
  v_plan_active boolean;
  v_workspace_creator uuid;
  v_future_max_seats integer;
  v_future_plan_code text;
begin
  if tg_op = 'UPDATE'
     and new.workspace_id = old.workspace_id
     and new.user_id = old.user_id then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.workspace_id::text, 1907)
  );

  if tg_op = 'UPDATE' then
    select pg_catalog.count(*)::integer
    into v_existing_members
    from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and not (
        wm.workspace_id = old.workspace_id
        and wm.user_id = old.user_id
      );
  else
    select pg_catalog.count(*)::integer
    into v_existing_members
    from public.workspace_members wm
    where wm.workspace_id = new.workspace_id;
  end if;

  select
    p.max_seats,
    s.status,
    p.code,
    p.is_active
  into
    v_max_seats,
    v_subscription_status,
    v_plan_code,
    v_plan_active
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.workspace_id = new.workspace_id;

  if not found then
    select w.created_by
    into v_workspace_creator
    from public.workspaces w
    where w.id = new.workspace_id;

    if v_existing_members = 0
       and new.role = 'owner'
       and new.user_id = v_workspace_creator then
      return new;
    end if;

    raise exception 'Workspace subscription required before adding members'
      using errcode = '23514';
  end if;

  if v_plan_active is not true
     or v_subscription_status not in ('trialing', 'active') then
    raise exception 'Workspace subscription is not active for seat changes'
      using errcode = '23514';
  end if;

  select p.max_seats, p.code
  into v_future_max_seats, v_future_plan_code
  from public.billing_change_requests bcr
  join public.plans p on p.id = bcr.to_plan_id
  where bcr.workspace_id = new.workspace_id
    and bcr.mode = 'scheduled'
    and bcr.status in ('processing', 'scheduled')
  order by bcr.created_at desc
  limit 1;

  if found
     and v_future_max_seats is not null
     and (v_max_seats is null or v_future_max_seats < v_max_seats) then
    v_max_seats := v_future_max_seats;
    v_plan_code := v_future_plan_code || ' (scheduled)';
  end if;

  if v_max_seats is not null and v_existing_members >= v_max_seats then
    raise exception 'Workspace seat limit exceeded'
      using
        errcode = '23514',
        detail = pg_catalog.format(
          'Plan %s allows at most %s workspace members.',
          v_plan_code,
          v_max_seats
        );
  end if;

  return new;
end;
$$;

revoke all on function private.guard_workspace_member_seat_limit() from public;
revoke all on function private.guard_workspace_member_seat_limit() from anon;
revoke all on function private.guard_workspace_member_seat_limit() from authenticated;
grant execute on function private.guard_workspace_member_seat_limit() to service_role;

create or replace function private.reconcile_scheduled_billing_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.plan_id is not distinct from old.plan_id
     and new.billing_cycle is not distinct from old.billing_cycle then
    return new;
  end if;

  update public.billing_change_requests bcr
  set
    status = 'applied',
    effective_at = coalesce(bcr.effective_at, pg_catalog.now()),
    error_code = null,
    updated_at = pg_catalog.now()
  where bcr.workspace_id = new.workspace_id
    and bcr.mode = 'scheduled'
    and bcr.status = 'scheduled'
    and bcr.to_plan_id = new.plan_id
    and bcr.to_billing_cycle = new.billing_cycle;

  return new;
end;
$$;

revoke all on function private.reconcile_scheduled_billing_change() from public;
revoke all on function private.reconcile_scheduled_billing_change() from anon;
revoke all on function private.reconcile_scheduled_billing_change() from authenticated;
grant execute on function private.reconcile_scheduled_billing_change() to service_role;

drop trigger if exists trg_reconcile_scheduled_billing_change on public.subscriptions;
create trigger trg_reconcile_scheduled_billing_change
after update of plan_id, billing_cycle on public.subscriptions
for each row
execute function private.reconcile_scheduled_billing_change();