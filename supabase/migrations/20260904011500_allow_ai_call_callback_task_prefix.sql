-- Extend the existing machine-created lead task guard for AI Call Qualifier callbacks.
-- Existing Follow-Up Engine production and QA behavior remains unchanged.

create or replace function private.guard_follow_up_task_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_timezone text;
  v_max_tasks_per_day integer;
  v_paused_until timestamptz;
  v_plan_code text;
  v_subscription_status text;
  v_local_day date;
  v_today_count integer;
  v_is_production boolean;
  v_is_qa boolean;
  v_is_ai_call_callback boolean;
begin
  if new.automation_key is null then
    return new;
  end if;

  v_is_production := new.automation_key like 'follow-up:v1:%';
  v_is_qa := new.automation_key like 'follow-up:qa:v1:%';
  v_is_ai_call_callback := new.automation_key like 'ai-call-callback:%';

  if not v_is_production and not v_is_qa and not v_is_ai_call_callback then
    raise exception 'Unsupported lead_tasks automation_key prefix';
  end if;

  -- Serialize machine-created tasks for the same workspace. This preserves the
  -- existing Follow-Up daily-cap race protection and makes callback inserts deterministic.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.workspace_id::text, 0)
  );

  -- AI Call callback tasks are internal CRM recovery tasks, not outbound calls.
  -- The prefix remains machine-only because authenticated clients cannot write
  -- lead_tasks.automation_key. Keep the shape narrow so the prefix cannot be
  -- reused for arbitrary service-role task creation.
  if v_is_ai_call_callback then
    if char_length(new.automation_key) <= char_length('ai-call-callback:')
       or char_length(new.automation_key) > char_length('ai-call-callback:') + 200 then
      raise exception 'Invalid AI Call callback automation key';
    end if;

    if new.title is distinct from 'Call back qualified lead'
       or new.status is distinct from 'open'
       or new.priority is distinct from 'high'
       or new.assigned_to is null then
      raise exception 'Invalid AI Call callback task shape';
    end if;

    return new;
  end if;

  -- Existing controlled Follow-Up QA behavior is unchanged.
  if v_is_qa then
    return new;
  end if;

  -- Existing Follow-Up production entitlement, enablement, pause, timezone,
  -- and per-day cap checks are preserved byte-for-byte in behavior below.
  select
    s.enabled,
    s.timezone,
    s.max_tasks_per_day,
    s.paused_until,
    p.code,
    sub.status
  into
    v_enabled,
    v_timezone,
    v_max_tasks_per_day,
    v_paused_until,
    v_plan_code,
    v_subscription_status
  from public.workspace_follow_up_settings s
  left join public.subscriptions sub
    on sub.workspace_id = s.workspace_id
  left join public.plans p
    on p.id = sub.plan_id
   and p.is_active = true
  where s.workspace_id = new.workspace_id;

  if not found then
    raise exception 'Follow-Up Engine settings missing for workspace %', new.workspace_id;
  end if;

  if v_enabled is not true then
    raise exception 'Follow-Up Engine is disabled for workspace %', new.workspace_id;
  end if;

  if v_paused_until is not null and v_paused_until > now() then
    raise exception 'Follow-Up Engine is paused for workspace %', new.workspace_id;
  end if;

  if coalesce(v_subscription_status, '') not in ('trialing', 'active')
     or coalesce(v_plan_code, '') not in ('starter', 'pro', 'white_label') then
    raise exception 'Workspace % is not entitled to Follow-Up automation', new.workspace_id;
  end if;

  begin
    v_local_day := (now() at time zone v_timezone)::date;
  exception when invalid_parameter_value then
    raise exception 'Invalid Follow-Up Engine timezone for workspace %', new.workspace_id;
  end;

  select count(*)::integer
  into v_today_count
  from public.lead_tasks t
  where t.workspace_id = new.workspace_id
    and t.automation_key like 'follow-up:v1:%'
    and (t.created_at at time zone v_timezone)::date = v_local_day;

  if v_today_count >= v_max_tasks_per_day then
    raise exception 'Follow-Up Engine daily task cap reached for workspace %', new.workspace_id;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_follow_up_task_insert() from public;
revoke all on function private.guard_follow_up_task_insert() from anon;
revoke all on function private.guard_follow_up_task_insert() from authenticated;
