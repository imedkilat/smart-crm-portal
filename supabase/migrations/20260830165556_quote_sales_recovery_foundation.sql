-- Quote Follow-Up Alerts + Sales Recovery Engine foundation.
-- SOURCE ONLY until explicitly reviewed and approved for production migration.
-- This migration does NOT send Slack/email, activate n8n, or contact customers.

-- ---------------------------------------------------------------------------
-- Quote lifecycle
-- ---------------------------------------------------------------------------

create table if not exists public.lead_quotes (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique
    default ('qte_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  workspace_id uuid not null
    references public.workspaces(id) on delete cascade,
  lead_id bigint not null,
  quote_reference text
    check (quote_reference is null or char_length(btrim(quote_reference)) between 1 and 120),
  amount numeric(14, 2)
    check (amount is null or amount >= 0),
  currency_code text not null default 'USD'
    check (currency_code ~ '^[A-Z]{3}$'),
  status text not null default 'draft'
    check (status in (
      'draft',
      'sent',
      'receipt_confirmed',
      'accepted',
      'declined',
      'expired',
      'superseded'
    )),
  sent_at timestamptz,
  receipt_confirmed_at timestamptz,
  expected_decision_at timestamptz,
  next_follow_up_at timestamptz,
  last_call_outcome text
    check (
      last_call_outcome is null
      or last_call_outcome in (
        'confirmed_received',
        'has_questions',
        'ready_to_schedule',
        'decision_later',
        'no_answer',
        'pricing_objection',
        'urgent',
        'not_interested'
      )
    ),
  supersedes_quote_id uuid,
  created_by uuid
    references auth.users(id) on delete set null
    default auth.uid(),
  updated_by uuid
    references auth.users(id) on delete set null
    default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_quotes_workspace_lead_fkey
    foreign key (workspace_id, lead_id)
    references public.leads(workspace_id, id)
    on delete cascade,
  constraint lead_quotes_workspace_id_id_lead_unique
    unique (workspace_id, id, lead_id),
  constraint lead_quotes_supersedes_same_lead_fkey
    foreign key (workspace_id, supersedes_quote_id, lead_id)
    references public.lead_quotes(workspace_id, id, lead_id)
    on delete restrict,
  constraint lead_quotes_receipt_after_send_check
    check (receipt_confirmed_at is null or sent_at is not null),
  constraint lead_quotes_decision_after_send_check
    check (expected_decision_at is null or sent_at is not null),
  constraint lead_quotes_no_self_supersede_check
    check (supersedes_quote_id is null or supersedes_quote_id <> id)
);

comment on table public.lead_quotes is
  'Workspace-scoped quote versions linked to CRM leads. Quote lifecycle is internal CRM state; outbound customer delivery is handled elsewhere.';
comment on column public.lead_quotes.supersedes_quote_id is
  'Optional previous quote version for the same workspace and lead. Revisions are separate rows rather than overwriting history.';
comment on column public.lead_quotes.last_call_outcome is
  'Current structured sales follow-up outcome. Full outcome history belongs in lead_activities metadata.';

create index if not exists lead_quotes_workspace_lead_created_idx
  on public.lead_quotes (workspace_id, lead_id, created_at desc);

create index if not exists lead_quotes_workspace_status_idx
  on public.lead_quotes (workspace_id, status, sent_at desc);

create index if not exists lead_quotes_next_follow_up_idx
  on public.lead_quotes (workspace_id, next_follow_up_at)
  where next_follow_up_at is not null
    and status not in ('accepted', 'declined', 'expired', 'superseded');

alter table public.lead_quotes enable row level security;

drop policy if exists lead_quotes_member_read on public.lead_quotes;
create policy lead_quotes_member_read
on public.lead_quotes
for select
to authenticated
using (
  (select private.is_workspace_member(lead_quotes.workspace_id))
);

drop policy if exists lead_quotes_member_insert on public.lead_quotes;
create policy lead_quotes_member_insert
on public.lead_quotes
for insert
to authenticated
with check (
  (select private.is_workspace_member(lead_quotes.workspace_id))
);

drop policy if exists lead_quotes_member_update on public.lead_quotes;
create policy lead_quotes_member_update
on public.lead_quotes
for update
to authenticated
using (
  (select private.is_workspace_member(lead_quotes.workspace_id))
)
with check (
  (select private.is_workspace_member(lead_quotes.workspace_id))
);

-- Hard delete is intentionally unavailable in v1. Terminal quote states preserve
-- sales/audit history and quote revisions can supersede prior rows.
drop policy if exists lead_quotes_member_delete on public.lead_quotes;

revoke all on table public.lead_quotes from anon;
revoke all on table public.lead_quotes from authenticated;

grant select on table public.lead_quotes to authenticated;
grant insert (
  workspace_id,
  lead_id,
  quote_reference,
  amount,
  currency_code,
  status,
  sent_at,
  receipt_confirmed_at,
  expected_decision_at,
  next_follow_up_at,
  last_call_outcome,
  supersedes_quote_id
) on table public.lead_quotes to authenticated;
grant update (
  quote_reference,
  amount,
  currency_code,
  status,
  sent_at,
  receipt_confirmed_at,
  expected_decision_at,
  next_follow_up_at,
  last_call_outcome
) on table public.lead_quotes to authenticated;
grant all on table public.lead_quotes to service_role;

create or replace function private.touch_lead_quote()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

revoke all on function private.touch_lead_quote() from public;
revoke all on function private.touch_lead_quote() from anon;
revoke all on function private.touch_lead_quote() from authenticated;

drop trigger if exists trg_lead_quotes_touch on public.lead_quotes;
create trigger trg_lead_quotes_touch
before update on public.lead_quotes
for each row execute function private.touch_lead_quote();

-- ---------------------------------------------------------------------------
-- Workspace alert preferences (non-secret configuration only)
-- ---------------------------------------------------------------------------

create table if not exists public.workspace_quote_alert_settings (
  workspace_id uuid primary key
    references public.workspaces(id) on delete cascade,
  enabled boolean not null default false,
  channel text not null default 'email'
    check (channel in ('email', 'slack')),
  destination_ref text
    check (destination_ref is null or char_length(btrim(destination_ref)) between 1 and 240),
  receipt_confirmation_delay_minutes integer not null default 120
    check (receipt_confirmation_delay_minutes between 5 and 10080),
  decision_reminder_lead_minutes integer not null default 60
    check (decision_reminder_lead_minutes between 0 and 10080),
  paused_until timestamptz,
  updated_by uuid
    references auth.users(id) on delete set null
    default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.workspace_quote_alert_settings is
  'Non-secret workspace preferences for internal quote follow-up alerts. Provider credentials must remain server-side.';
comment on column public.workspace_quote_alert_settings.destination_ref is
  'Non-secret provider destination reference such as a Slack channel ID or internal email recipient reference; never store tokens/webhook secrets here.';

alter table public.workspace_quote_alert_settings enable row level security;

drop policy if exists workspace_quote_alert_settings_member_read
  on public.workspace_quote_alert_settings;
create policy workspace_quote_alert_settings_member_read
on public.workspace_quote_alert_settings
for select
to authenticated
using (
  (select private.is_workspace_member(workspace_quote_alert_settings.workspace_id))
);

drop policy if exists workspace_quote_alert_settings_admin_update
  on public.workspace_quote_alert_settings;
create policy workspace_quote_alert_settings_admin_update
on public.workspace_quote_alert_settings
for update
to authenticated
using (
  (select private.is_workspace_member(
    workspace_quote_alert_settings.workspace_id,
    array['owner'::text, 'admin'::text]
  ))
)
with check (
  (select private.is_workspace_member(
    workspace_quote_alert_settings.workspace_id,
    array['owner'::text, 'admin'::text]
  ))
);

-- Rows are seeded by server-owned migration/trigger; browser insert/delete is disabled.
drop policy if exists workspace_quote_alert_settings_member_insert
  on public.workspace_quote_alert_settings;
drop policy if exists workspace_quote_alert_settings_member_delete
  on public.workspace_quote_alert_settings;

revoke all on table public.workspace_quote_alert_settings from anon;
revoke all on table public.workspace_quote_alert_settings from authenticated;

grant select on table public.workspace_quote_alert_settings to authenticated;
grant update (
  enabled,
  channel,
  destination_ref,
  receipt_confirmation_delay_minutes,
  decision_reminder_lead_minutes,
  paused_until
) on table public.workspace_quote_alert_settings to authenticated;
grant all on table public.workspace_quote_alert_settings to service_role;

create or replace function private.touch_workspace_quote_alert_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

revoke all on function private.touch_workspace_quote_alert_settings() from public;
revoke all on function private.touch_workspace_quote_alert_settings() from anon;
revoke all on function private.touch_workspace_quote_alert_settings() from authenticated;

drop trigger if exists trg_workspace_quote_alert_settings_touch
  on public.workspace_quote_alert_settings;
create trigger trg_workspace_quote_alert_settings_touch
before update on public.workspace_quote_alert_settings
for each row execute function private.touch_workspace_quote_alert_settings();

insert into public.workspace_quote_alert_settings (workspace_id)
select id from public.workspaces
on conflict (workspace_id) do nothing;

create or replace function private.ensure_workspace_quote_alert_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_quote_alert_settings (workspace_id, updated_by)
  values (new.id, new.created_by)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

revoke all on function private.ensure_workspace_quote_alert_settings() from public;
revoke all on function private.ensure_workspace_quote_alert_settings() from anon;
revoke all on function private.ensure_workspace_quote_alert_settings() from authenticated;

drop trigger if exists trg_workspaces_ensure_quote_alert_settings
  on public.workspaces;
create trigger trg_workspaces_ensure_quote_alert_settings
after insert on public.workspaces
for each row execute function private.ensure_workspace_quote_alert_settings();

-- ---------------------------------------------------------------------------
-- Idempotent internal alert ledger
-- ---------------------------------------------------------------------------

create table if not exists public.quote_alerts (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique
    default ('qal_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  workspace_id uuid not null
    references public.workspaces(id) on delete cascade,
  quote_id uuid not null,
  lead_id bigint not null,
  alert_type text not null
    check (alert_type in (
      'receipt_confirmation_due',
      'decision_follow_up_due',
      'decision_overdue',
      'urgent_escalation'
    )),
  channel text not null
    check (channel in ('email', 'slack')),
  destination_ref text
    check (destination_ref is null or char_length(btrim(destination_ref)) between 1 and 240),
  automation_key text not null
    check (char_length(btrim(automation_key)) between 3 and 180),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'acknowledged', 'cancelled')),
  scheduled_for timestamptz not null,
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  acknowledged_at timestamptz,
  provider_message_id text,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_alerts_workspace_quote_lead_fkey
    foreign key (workspace_id, quote_id, lead_id)
    references public.lead_quotes(workspace_id, id, lead_id)
    on delete cascade,
  unique (workspace_id, automation_key)
);

comment on table public.quote_alerts is
  'Idempotent internal-alert ledger for quote follow-up. Authenticated users may read tenant rows, but delivery-state writes are service-role-owned in v1.';
comment on column public.quote_alerts.automation_key is
  'Stable logical-event key used to prevent duplicate alerts, e.g. quote-receipt:qte_xxx.';

create index if not exists quote_alerts_due_idx
  on public.quote_alerts (status, scheduled_for)
  where status in ('pending', 'failed');

create index if not exists quote_alerts_workspace_lead_idx
  on public.quote_alerts (workspace_id, lead_id, created_at desc);

alter table public.quote_alerts enable row level security;

drop policy if exists quote_alerts_member_read on public.quote_alerts;
create policy quote_alerts_member_read
on public.quote_alerts
for select
to authenticated
using (
  (select private.is_workspace_member(quote_alerts.workspace_id))
);

-- Delivery creation/state transitions are automation-owned. A future acknowledgement
-- action should use a narrow server-side RPC/Edge Function rather than broad browser UPDATE.
drop policy if exists quote_alerts_member_insert on public.quote_alerts;
drop policy if exists quote_alerts_member_update on public.quote_alerts;
drop policy if exists quote_alerts_member_delete on public.quote_alerts;

revoke all on table public.quote_alerts from anon;
revoke all on table public.quote_alerts from authenticated;

grant select on table public.quote_alerts to authenticated;
grant all on table public.quote_alerts to service_role;

create or replace function private.touch_quote_alert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_quote_alert() from public;
revoke all on function private.touch_quote_alert() from anon;
revoke all on function private.touch_quote_alert() from authenticated;

drop trigger if exists trg_quote_alerts_touch on public.quote_alerts;
create trigger trg_quote_alerts_touch
before update on public.quote_alerts
for each row execute function private.touch_quote_alert();
