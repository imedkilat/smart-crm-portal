-- Close two scheduled billing lifecycle race windows:
-- 1. a Stripe phase transition may arrive while the request is still processing;
-- 2. finalization must never overwrite an already-applied request back to scheduled.

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
    and bcr.status in ('processing', 'scheduled')
    and bcr.to_plan_id = new.plan_id
    and bcr.to_billing_cycle = new.billing_cycle;

  return new;
end;
$$;

revoke all on function private.reconcile_scheduled_billing_change() from public;
revoke all on function private.reconcile_scheduled_billing_change() from anon;
revoke all on function private.reconcile_scheduled_billing_change() from authenticated;
grant execute on function private.reconcile_scheduled_billing_change() to service_role;

create or replace function public.finalize_scheduled_billing_change_request(
  p_request_id text,
  p_stripe_subscription_schedule_id text,
  p_effective_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_to_plan_id uuid;
  v_to_billing_cycle text;
  v_request_status text;
  v_current_plan_id uuid;
  v_current_billing_cycle text;
  v_next_status text;
begin
  if p_request_id !~ '^bchg_[a-f0-9]{32}$' then
    raise exception 'Invalid billing change request id' using errcode = '22023';
  end if;

  if p_stripe_subscription_schedule_id is null
     or p_stripe_subscription_schedule_id !~ '^sub_sched_[A-Za-z0-9]+$' then
    raise exception 'Invalid Stripe subscription schedule id' using errcode = '22023';
  end if;

  if p_effective_at is null then
    raise exception 'Scheduled billing change effective time is required' using errcode = '22023';
  end if;

  select
    bcr.workspace_id,
    bcr.to_plan_id,
    bcr.to_billing_cycle,
    bcr.status
  into
    v_workspace_id,
    v_to_plan_id,
    v_to_billing_cycle,
    v_request_status
  from public.billing_change_requests bcr
  where bcr.request_id = p_request_id
    and bcr.mode = 'scheduled'
  for update;

  if not found then
    raise exception 'Scheduled billing change request not found' using errcode = 'P0002';
  end if;

  if v_request_status not in ('processing', 'scheduled', 'applied') then
    raise exception 'Scheduled billing change request is no longer finalizable'
      using errcode = '23514';
  end if;

  select s.plan_id, s.billing_cycle
  into v_current_plan_id, v_current_billing_cycle
  from public.subscriptions s
  where s.workspace_id = v_workspace_id;

  if not found then
    raise exception 'Workspace subscription baseline is missing' using errcode = '23514';
  end if;

  if v_request_status = 'applied'
     or (
       v_current_plan_id = v_to_plan_id
       and v_current_billing_cycle = v_to_billing_cycle
     ) then
    v_next_status := 'applied';
  else
    v_next_status := 'scheduled';
  end if;

  update public.billing_change_requests
  set
    status = v_next_status,
    stripe_subscription_schedule_id = p_stripe_subscription_schedule_id,
    effective_at = coalesce(effective_at, p_effective_at),
    error_code = null,
    updated_at = pg_catalog.now()
  where request_id = p_request_id;

  return v_next_status;
end;
$$;

revoke all on function public.finalize_scheduled_billing_change_request(text, text, timestamptz) from public;
revoke all on function public.finalize_scheduled_billing_change_request(text, text, timestamptz) from anon;
revoke all on function public.finalize_scheduled_billing_change_request(text, text, timestamptz) from authenticated;
grant execute on function public.finalize_scheduled_billing_change_request(text, text, timestamptz) to service_role;