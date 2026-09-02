create table if not exists public.billing_change_requests (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requested_by uuid not null,
  from_plan_id uuid not null references public.plans(id),
  to_plan_id uuid not null references public.plans(id),
  from_billing_cycle text not null,
  to_billing_cycle text not null,
  mode text not null,
  status text not null default 'processing',
  stripe_subscription_id text not null,
  stripe_subscription_schedule_id text,
  stripe_invoice_id text,
  effective_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_change_requests_request_id_check
    check (request_id ~ '^bchg_[a-f0-9]{32}$'),
  constraint billing_change_requests_from_cycle_check
    check (from_billing_cycle in ('monthly', 'annual')),
  constraint billing_change_requests_to_cycle_check
    check (to_billing_cycle in ('monthly', 'annual')),
  constraint billing_change_requests_mode_check
    check (mode in ('immediate', 'scheduled')),
  constraint billing_change_requests_status_check
    check (status in ('processing', 'applied', 'failed', 'scheduled', 'canceled'))
);

create unique index if not exists billing_change_requests_workspace_active_uidx
  on public.billing_change_requests (workspace_id)
  where status in ('processing', 'scheduled');

create index if not exists billing_change_requests_workspace_created_idx
  on public.billing_change_requests (workspace_id, created_at desc);

create index if not exists billing_change_requests_from_plan_idx
  on public.billing_change_requests (from_plan_id);

create index if not exists billing_change_requests_to_plan_idx
  on public.billing_change_requests (to_plan_id);

alter table public.billing_change_requests enable row level security;

revoke all on table public.billing_change_requests from public;
revoke all on table public.billing_change_requests from anon;
revoke all on table public.billing_change_requests from authenticated;
grant select, insert, update, delete on table public.billing_change_requests to service_role;

comment on table public.billing_change_requests is
  'Machine-only ledger and concurrency boundary for authenticated Stripe billing plan changes.';

comment on column public.billing_change_requests.request_id is
  'Stable server-derived request identifier based on workspace, requester, and idempotency key.';

do $$
begin
  if has_table_privilege('anon', 'public.billing_change_requests', 'select')
     or has_table_privilege('authenticated', 'public.billing_change_requests', 'select')
     or has_table_privilege('authenticated', 'public.billing_change_requests', 'insert')
     or has_table_privilege('authenticated', 'public.billing_change_requests', 'update')
     or has_table_privilege('authenticated', 'public.billing_change_requests', 'delete') then
    raise exception 'billing_change_requests browser-role privileges must remain revoked';
  end if;

  if not has_table_privilege('service_role', 'public.billing_change_requests', 'select')
     or not has_table_privilege('service_role', 'public.billing_change_requests', 'insert')
     or not has_table_privilege('service_role', 'public.billing_change_requests', 'update')
     or not has_table_privilege('service_role', 'public.billing_change_requests', 'delete') then
    raise exception 'billing_change_requests service_role privileges are incomplete';
  end if;
end
$$;
