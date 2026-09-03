-- AI Call Qualifier outcome logging foundation.
-- Source-only until explicitly merged/applied. No Retell dispatch or live calling is introduced here.

create table if not exists public.ai_call_event_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id bigint not null,
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 1 and 300),
  activity_type text not null,
  crm_activity_public_id text,
  lead_activity_public_id text,
  callback_task_public_id text,
  created_at timestamptz not null default now(),
  constraint ai_call_event_receipts_workspace_lead_fkey
    foreign key (workspace_id, lead_id)
    references public.leads(workspace_id, id)
    on delete cascade,
  constraint ai_call_event_receipts_workspace_key_unique
    unique (workspace_id, idempotency_key)
);

comment on table public.ai_call_event_receipts is
  'Machine-only idempotency ledger for AI Call Qualifier CRM outcome writes. No provider secrets or transcript bodies belong here.';

create index if not exists ai_call_event_receipts_lead_time_idx
  on public.ai_call_event_receipts(workspace_id, lead_id, created_at desc);

alter table public.ai_call_event_receipts enable row level security;
revoke all on table public.ai_call_event_receipts from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_call_event_receipts to service_role;

create or replace function public.record_ai_call_outcome(
  p_workspace_id uuid,
  p_lead_id bigint,
  p_idempotency_key text,
  p_activity_type text,
  p_title text,
  p_metadata jsonb default '{}'::jsonb,
  p_provider_call_id text default null,
  p_create_callback boolean default false,
  p_callback_reason text default null,
  p_callback_due_at timestamptz default null
)
returns table (
  crm_activity_public_id text,
  lead_activity_public_id text,
  callback_task_public_id text,
  duplicate boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_public_id text;
  v_owner_user_id uuid;
  v_existing_lead_id bigint;
  v_existing_activity_type text;
  v_crm_activity_public_id text;
  v_lead_activity_public_id text;
  v_callback_task_public_id text;
  v_metadata jsonb;
  v_inserted_receipt_id uuid;
begin
  if p_workspace_id is null or p_lead_id is null then
    raise exception 'workspace_id and lead_id are required';
  end if;

  if nullif(trim(p_idempotency_key), '') is null
     or char_length(trim(p_idempotency_key)) > 300 then
    raise exception 'Invalid AI call idempotency key';
  end if;

  if p_activity_type not in (
    'ai_call.started',
    'ai_call.qualified',
    'ai_call.not_qualified',
    'ai_call.needs_follow_up',
    'ai_call.opted_out',
    'ai_call.no_answer',
    'ai_call.voicemail',
    'ai_call.failed',
    'ai_call.transfer_started',
    'ai_call.transferred',
    'ai_call.rep_declined',
    'ai_call.rep_no_answer',
    'ai_call.transfer_timeout',
    'ai_call.transfer_failed',
    'ai_call.completed'
  ) then
    raise exception 'Unsupported AI call activity type: %', p_activity_type;
  end if;

  if nullif(trim(p_title), '') is null or char_length(trim(p_title)) > 240 then
    raise exception 'AI call activity title must be 1-240 characters';
  end if;

  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'AI call metadata must be a JSON object';
  end if;

  select l.public_id, l.owner_user_id
    into v_lead_public_id, v_owner_user_id
  from public.leads l
  where l.workspace_id = p_workspace_id
    and l.id = p_lead_id;

  if v_lead_public_id is null then
    raise exception 'Lead does not belong to the requested workspace';
  end if;

  if p_create_callback then
    if v_owner_user_id is null then
      raise exception 'Callback task requires an assigned lead owner';
    end if;

    if nullif(trim(p_provider_call_id), '') is null
       or char_length(trim(p_provider_call_id)) > 200 then
      raise exception 'Callback task requires a valid provider call id';
    end if;
  end if;

  select r.lead_id,
         r.activity_type,
         r.crm_activity_public_id,
         r.lead_activity_public_id,
         r.callback_task_public_id
    into v_existing_lead_id,
         v_existing_activity_type,
         v_crm_activity_public_id,
         v_lead_activity_public_id,
         v_callback_task_public_id
  from public.ai_call_event_receipts r
  where r.workspace_id = p_workspace_id
    and r.idempotency_key = trim(p_idempotency_key);

  if found then
    if v_existing_lead_id is distinct from p_lead_id
       or v_existing_activity_type is distinct from p_activity_type then
      raise exception 'AI call idempotency key already belongs to a different lead/event';
    end if;

    return query select
      v_crm_activity_public_id,
      v_lead_activity_public_id,
      v_callback_task_public_id,
      true;
    return;
  end if;

  insert into public.ai_call_event_receipts (
    workspace_id,
    lead_id,
    idempotency_key,
    activity_type
  ) values (
    p_workspace_id,
    p_lead_id,
    trim(p_idempotency_key),
    p_activity_type
  )
  on conflict (workspace_id, idempotency_key) do nothing
  returning id into v_inserted_receipt_id;

  if v_inserted_receipt_id is null then
    select r.lead_id,
           r.activity_type,
           r.crm_activity_public_id,
           r.lead_activity_public_id,
           r.callback_task_public_id
      into v_existing_lead_id,
           v_existing_activity_type,
           v_crm_activity_public_id,
           v_lead_activity_public_id,
           v_callback_task_public_id
    from public.ai_call_event_receipts r
    where r.workspace_id = p_workspace_id
      and r.idempotency_key = trim(p_idempotency_key);

    if v_existing_lead_id is distinct from p_lead_id
       or v_existing_activity_type is distinct from p_activity_type then
      raise exception 'AI call idempotency key already belongs to a different lead/event';
    end if;

    return query select
      v_crm_activity_public_id,
      v_lead_activity_public_id,
      v_callback_task_public_id,
      true;
    return;
  end if;

  v_metadata := coalesce(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'source', 'ai_call_qualifier',
      'ai_call_event_key', trim(p_idempotency_key),
      'provider_call_id', nullif(trim(coalesce(p_provider_call_id, '')), '')
    );

  insert into public.crm_activities (
    workspace_id,
    record_type,
    record_id,
    activity_type,
    title,
    metadata,
    actor_user_id
  ) values (
    p_workspace_id,
    'lead',
    v_lead_public_id,
    p_activity_type,
    trim(p_title),
    v_metadata,
    null
  )
  returning public_id into v_crm_activity_public_id;

  insert into public.lead_activities (
    workspace_id,
    lead_id,
    activity_type,
    title,
    metadata,
    actor_user_id
  ) values (
    p_workspace_id,
    p_lead_id,
    p_activity_type,
    trim(p_title),
    v_metadata,
    null
  )
  returning public_id into v_lead_activity_public_id;

  if p_create_callback then
    insert into public.lead_tasks (
      workspace_id,
      lead_id,
      title,
      description,
      status,
      priority,
      due_at,
      assigned_to,
      created_by,
      automation_key
    ) values (
      p_workspace_id,
      p_lead_id,
      'Call back qualified lead',
      coalesce(nullif(trim(p_callback_reason), ''), 'AI qualification completed, but the warm transfer did not complete.'),
      'open',
      'high',
      coalesce(p_callback_due_at, now() + interval '15 minutes'),
      v_owner_user_id,
      null,
      'ai-call-callback:' || trim(p_provider_call_id)
    )
    on conflict (workspace_id, automation_key)
      where automation_key is not null
      do update set automation_key = excluded.automation_key
    returning public_id into v_callback_task_public_id;
  end if;

  update public.ai_call_event_receipts
  set crm_activity_public_id = v_crm_activity_public_id,
      lead_activity_public_id = v_lead_activity_public_id,
      callback_task_public_id = v_callback_task_public_id
  where id = v_inserted_receipt_id;

  return query select
    v_crm_activity_public_id,
    v_lead_activity_public_id,
    v_callback_task_public_id,
    false;
end;
$$;

comment on function public.record_ai_call_outcome(uuid, bigint, text, text, text, jsonb, text, boolean, text, timestamptz) is
  'Trusted server-side AI Call Qualifier outcome writer. Atomically mirrors one event to crm_activities + lead_activities and can create one idempotent callback task. Service-role only; does not initiate calls.';

revoke all on function public.record_ai_call_outcome(uuid, bigint, text, text, text, jsonb, text, boolean, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_ai_call_outcome(uuid, bigint, text, text, text, jsonb, text, boolean, text, timestamptz)
  to service_role;
