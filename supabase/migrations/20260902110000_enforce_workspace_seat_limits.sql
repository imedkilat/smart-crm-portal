-- Enforce commercial seat limits at the workspace membership write boundary.
--
-- workspace_members is directly writable by authenticated workspace creators,
-- so plans.max_seats must be enforced in Postgres rather than only in UI code.
-- The first owner membership is allowed before a subscription exists because
-- ensure_workspace_onboarding creates that owner row before inserting the
-- workspace subscription in the same transaction.

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
begin
  -- Role-only updates do not consume an additional seat.
  if tg_op = 'UPDATE'
     and new.workspace_id = old.workspace_id
     and new.user_id = old.user_id then
    return new;
  end if;

  -- Serialize seat-consuming writes per workspace so concurrent inserts cannot
  -- both observe the same available final seat.
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
    -- Safe onboarding bootstrap only: the workspace creator may become the
    -- initial owner before ensure_workspace_onboarding creates the subscription.
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

  -- A NULL max_seats is an intentional unlimited/custom-plan value.
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

comment on function private.guard_workspace_member_seat_limit() is
  'Trigger-only commercial guard for plans.max_seats. Serializes seat-consuming membership writes and preserves the first-owner onboarding bootstrap.';

drop trigger if exists trg_workspace_members_seat_limit on public.workspace_members;
create trigger trg_workspace_members_seat_limit
before insert or update of workspace_id, user_id
on public.workspace_members
for each row
execute function private.guard_workspace_member_seat_limit();

comment on trigger trg_workspace_members_seat_limit on public.workspace_members is
  'Enforces the active workspace plan max_seats limit before a membership write can consume a seat.';

-- Migration-time assertions: fail closed if the trigger or execution boundary
-- is not installed as intended.
do $$
declare
  v_trigger_enabled "char";
begin
  select t.tgenabled
  into v_trigger_enabled
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.workspace_members'::pg_catalog.regclass
    and t.tgname = 'trg_workspace_members_seat_limit'
    and not t.tgisinternal;

  if v_trigger_enabled is null or v_trigger_enabled = 'D' then
    raise exception 'workspace member seat-limit trigger must be enabled';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated',
       'private.guard_workspace_member_seat_limit()',
       'EXECUTE'
     ) then
    raise exception 'authenticated must not directly execute the seat-limit guard';
  end if;

  if not pg_catalog.has_function_privilege(
       'service_role',
       'private.guard_workspace_member_seat_limit()',
       'EXECUTE'
     ) then
    raise exception 'service_role execute access to the seat-limit guard must remain available';
  end if;
end
$$;
