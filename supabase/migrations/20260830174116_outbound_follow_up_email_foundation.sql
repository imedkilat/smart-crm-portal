-- Outbound Follow-Up Email Engine foundation.
-- SOURCE ONLY until explicitly approved for production migration.
-- This migration does not send email and does not enable outbound delivery.

-- ---------------------------------------------------------------------------
-- Workspace-level outbound email policy
-- ---------------------------------------------------------------------------

create table if not exists public.workspace_outbound_email_settings (
  workspace_id uuid primary key
    references public.workspaces(id) on delete cascade,
  enabled boolean not null default false,
  mode text not null default 'disabled'
    check (mode in ('disabled', 'simulate', 'live')),
  provider text
    check (
      provider is null
      or provider ~ '^[a-z0-9][a-z0-9_-]{0,79}$'
    ),
  max_emails_per_run integer not null default 1
    check (max_emails_per_run between 1 and 100),
  max_emails_per_day integer not null default 20
    check (max_emails_per_day between 1 and 10000),
  paused_until timestamptz,
  updated_by uuid
    references auth.users(id) on delete set null
    default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_outbound_email_live_requires_provider_check
    check (mode <> 'live' or provider is not null),
  constraint workspace_outbound_email_enabled_mode_check
    check (enabled = false or mode <> 'disabled')
);

comment on table public.workspace_outbound_email_settings is
  'Workspace-scoped customer-email delivery policy. Defaults are disabled; provider credentials remain server-side.';
comment on column public.workspace_outbound_email_settings.mode is
  'disabled blocks dispatch, simulate renders/logs without a provider call, live permits a configured provider adapter.';
comment on column public.workspace_outbound_email_settings.provider is
  'Non-secret provider adapter name only. API keys and sender credentials must stay in Edge Function secrets.';

alter table public.workspace_outbound_email_settings enable row level security;

drop policy if exists workspace_outbound_email_settings_member_read
  on public.workspace_outbound_email_settings;
create policy workspace_outbound_email_settings_member_read
on public.workspace_outbound_email_settings
for select
to authenticated
using (
  (select private.is_workspace_member(workspace_outbound_email_settings.workspace_id))
);

drop policy if exists workspace_outbound_email_settings_admin_update
  on public.workspace_outbound_email_settings;
create policy workspace_outbound_email_settings_admin_update
on public.workspace_outbound_email_settings
for update
to authenticated
using (
  (select private.is_workspace_member(
    workspace_outbound_email_settings.workspace_id,
    array['owner'::text, 'admin'::text]
  ))
)
with check (
  (select private.is_workspace_member(
    workspace_outbound_email_settings.workspace_id,
    array['owner'::text, 'admin'::text]
  ))
);

drop policy if exists workspace_outbound_email_settings_member_insert
  on public.workspace_outbound_email_settings;
drop policy if exists workspace_outbound_email_settings_member_delete
  on public.workspace_outbound_email_settings;

revoke all on table public.workspace_outbound_email_settings from anon;
revoke all on table public.workspace_outbound_email_settings from authenticated;

grant select on table public.workspace_outbound_email_settings to authenticated;
grant update (
  enabled,
  mode,
  provider,
  max_emails_per_run,
  max_emails_per_day,
  paused_until
) on table public.workspace_outbound_email_settings to authenticated;
grant all on table public.workspace_outbound_email_settings to service_role;

create or replace function private.touch_workspace_outbound_email_settings()
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

revoke all on function private.touch_workspace_outbound_email_settings() from public;
revoke all on function private.touch_workspace_outbound_email_settings() from anon;
revoke all on function private.touch_workspace_outbound_email_settings() from authenticated;

drop trigger if exists trg_workspace_outbound_email_settings_touch
  on public.workspace_outbound_email_settings;
create trigger trg_workspace_outbound_email_settings_touch
before update on public.workspace_outbound_email_settings
for each row execute function private.touch_workspace_outbound_email_settings();

insert into public.workspace_outbound_email_settings (workspace_id)
select id from public.workspaces
on conflict (workspace_id) do nothing;

create or replace function private.ensure_workspace_outbound_email_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_outbound_email_settings (workspace_id, updated_by)
  values (new.id, new.created_by)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

revoke all on function private.ensure_workspace_outbound_email_settings() from public;
revoke all on function private.ensure_workspace_outbound_email_settings() from anon;
revoke all on function private.ensure_workspace_outbound_email_settings() from authenticated;

drop trigger if exists trg_workspaces_ensure_outbound_email_settings
  on public.workspaces;
create trigger trg_workspaces_ensure_outbound_email_settings
after insert on public.workspaces
for each row execute function private.ensure_workspace_outbound_email_settings();

-- ---------------------------------------------------------------------------
-- Idempotent delivery ledger
-- ---------------------------------------------------------------------------

create table if not exists public.outbound_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique
    default ('emd_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  workspace_id uuid not null
    references public.workspaces(id) on delete cascade,
  lead_id bigint not null,
  template_key text not null,
  idempotency_key text not null
    check (char_length(btrim(idempotency_key)) between 8 and 180),
  mode text not null
    check (mode in ('simulate', 'live')),
  provider text,
  to_email text not null
    check (char_length(btrim(to_email)) between 3 and 320),
  rendered_subject text not null
    check (char_length(rendered_subject) between 1 and 998),
  rendered_body text not null,
  status text not null default 'prepared'
    check (status in (
      'prepared',
      'simulated',
      'sending',
      'sent',
      'delivered',
      'bounced',
      'failed',
      'cancelled'
    )),
  scheduled_for timestamptz not null default now(),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  provider_message_id text,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_email_deliveries_workspace_lead_fkey
    foreign key (workspace_id, lead_id)
    references public.leads(workspace_id, id)
    on delete cascade,
  constraint outbound_email_deliveries_workspace_template_fkey
    foreign key (workspace_id, template_key)
    references public.message_templates(workspace_id, template_key)
    on delete restrict,
  constraint outbound_email_deliveries_workspace_id_id_unique
    unique (workspace_id, id),
  constraint outbound_email_deliveries_workspace_idempotency_unique
    unique (workspace_id, idempotency_key),
  constraint outbound_email_deliveries_live_requires_provider_check
    check (mode <> 'live' or provider is not null)
);

comment on table public.outbound_email_deliveries is
  'Rendered customer-email delivery ledger. Every logical send is tenant-scoped and idempotent; browser clients have read-only access.';
comment on column public.outbound_email_deliveries.idempotency_key is
  'Stable logical-send key supplied by trusted automation to prevent duplicate customer messages.';

create index if not exists outbound_email_deliveries_due_idx
  on public.outbound_email_deliveries (status, scheduled_for)
  where status in ('prepared', 'failed');

create index if not exists outbound_email_deliveries_workspace_lead_idx
  on public.outbound_email_deliveries (workspace_id, lead_id, created_at desc);

create index if not exists outbound_email_deliveries_workspace_status_idx
  on public.outbound_email_deliveries (workspace_id, status, created_at desc);

alter table public.outbound_email_deliveries enable row level security;

drop policy if exists outbound_email_deliveries_member_read
  on public.outbound_email_deliveries;
create policy outbound_email_deliveries_member_read
on public.outbound_email_deliveries
for select
to authenticated
using (
  (select private.is_workspace_member(outbound_email_deliveries.workspace_id))
);

drop policy if exists outbound_email_deliveries_member_insert
  on public.outbound_email_deliveries;
drop policy if exists outbound_email_deliveries_member_update
  on public.outbound_email_deliveries;
drop policy if exists outbound_email_deliveries_member_delete
  on public.outbound_email_deliveries;

revoke all on table public.outbound_email_deliveries from anon;
revoke all on table public.outbound_email_deliveries from authenticated;

grant select on table public.outbound_email_deliveries to authenticated;
grant all on table public.outbound_email_deliveries to service_role;

create or replace function private.touch_outbound_email_delivery()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_outbound_email_delivery() from public;
revoke all on function private.touch_outbound_email_delivery() from anon;
revoke all on function private.touch_outbound_email_delivery() from authenticated;

drop trigger if exists trg_outbound_email_deliveries_touch
  on public.outbound_email_deliveries;
create trigger trg_outbound_email_deliveries_touch
before update on public.outbound_email_deliveries
for each row execute function private.touch_outbound_email_delivery();

-- ---------------------------------------------------------------------------
-- Append-only delivery attempt log
-- ---------------------------------------------------------------------------

create table if not exists public.outbound_email_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces(id) on delete cascade,
  delivery_id uuid not null,
  attempt_number integer not null
    check (attempt_number >= 1),
  mode text not null
    check (mode in ('simulate', 'live')),
  provider text,
  status text not null
    check (status in ('simulated', 'sent', 'failed')),
  provider_message_id text,
  http_status integer
    check (http_status is null or http_status between 100 and 599),
  error_code text,
  error_message text,
  response_metadata jsonb not null default '{}'::jsonb,
  attempted_at timestamptz not null default now(),
  constraint outbound_email_attempts_workspace_delivery_fkey
    foreign key (workspace_id, delivery_id)
    references public.outbound_email_deliveries(workspace_id, id)
    on delete cascade,
  constraint outbound_email_attempts_delivery_attempt_unique
    unique (delivery_id, attempt_number)
);

comment on table public.outbound_email_attempts is
  'Append-only provider/simulation attempt history for outbound customer email deliveries.';

create index if not exists outbound_email_attempts_workspace_delivery_idx
  on public.outbound_email_attempts (workspace_id, delivery_id, attempted_at desc);

alter table public.outbound_email_attempts enable row level security;

drop policy if exists outbound_email_attempts_member_read
  on public.outbound_email_attempts;
create policy outbound_email_attempts_member_read
on public.outbound_email_attempts
for select
to authenticated
using (
  (select private.is_workspace_member(outbound_email_attempts.workspace_id))
);

drop policy if exists outbound_email_attempts_member_insert
  on public.outbound_email_attempts;
drop policy if exists outbound_email_attempts_member_update
  on public.outbound_email_attempts;
drop policy if exists outbound_email_attempts_member_delete
  on public.outbound_email_attempts;

revoke all on table public.outbound_email_attempts from anon;
revoke all on table public.outbound_email_attempts from authenticated;
revoke all on table public.outbound_email_attempts from service_role;

grant select on table public.outbound_email_attempts to authenticated;
grant select, insert on table public.outbound_email_attempts to service_role;
