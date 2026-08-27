-- Captured from the live Supabase catalog on 2026-08-27.
-- Remote migration history already records this version as applied.
-- This file restores the missing GitHub source of truth for fresh environments.

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{0,49}$'),
  name text not null check (char_length(name) between 1 and 100),
  description text,
  price_monthly numeric,
  price_annual numeric,
  currency_code text not null default 'USD' check (currency_code ~ '^[A-Z]{3}$'),
  stripe_product_id text,
  stripe_price_id_monthly text,
  stripe_price_id_annual text,
  max_seats integer,
  max_leads_per_month integer,
  max_ai_interactions_per_month integer,
  features jsonb not null default '[]'::jsonb,
  is_public boolean not null default true,
  is_active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default (
    'sub_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
  ),
  workspace_id uuid not null unique
    references public.workspaces(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'paused')),
  billing_cycle text not null default 'monthly'
    check (billing_cycle in ('monthly', 'annual', 'custom', 'none')),
  deployment_type text not null default 'hosted'
    check (deployment_type in ('hosted', 'white_label')),
  stripe_customer_id text,
  stripe_subscription_id text,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_counters (
  workspace_id uuid not null
    references public.workspaces(id) on delete cascade,
  metric text not null
    check (metric in ('leads_created', 'ai_interactions', 'seats_active')),
  period_start date not null,
  period_end date not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, metric, period_start)
);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  stripe_event_id text unique,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

comment on table public.plans is
  'Sellable plan catalog. Used for both hosted SaaS pricing and white-label/custom deals.';
comment on table public.subscriptions is
  'Current subscription state per workspace. One row per workspace; Stripe is the source of truth for payment state, this mirrors it for fast reads.';
comment on table public.usage_counters is
  'Per-workspace, per-period usage metering used to enforce plan limits (max_leads_per_month, max_ai_interactions_per_month, etc).';
comment on table public.billing_events is
  'Raw Stripe webhook events, kept for audit + idempotent processing (unique stripe_event_id).';

create index if not exists idx_subscriptions_workspace
  on public.subscriptions (workspace_id);
create index if not exists idx_subscriptions_stripe_sub
  on public.subscriptions (stripe_subscription_id);
create index if not exists idx_usage_counters_workspace_period
  on public.usage_counters (workspace_id, period_start);
create index if not exists idx_billing_events_workspace
  on public.billing_events (workspace_id);

drop trigger if exists trg_plans_updated_at on public.plans;
create trigger trg_plans_updated_at
before update on public.plans
for each row execute function private.set_updated_at();

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
before update on public.subscriptions
for each row execute function private.set_updated_at();

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_counters enable row level security;
alter table public.billing_events enable row level security;

drop policy if exists plans_public_read on public.plans;
create policy plans_public_read
on public.plans for select
using (is_public = true and is_active = true);

drop policy if exists subscriptions_member_read on public.subscriptions;
create policy subscriptions_member_read
on public.subscriptions for select
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = subscriptions.workspace_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists usage_counters_member_read on public.usage_counters;
create policy usage_counters_member_read
on public.usage_counters for select
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = usage_counters.workspace_id
      and wm.user_id = auth.uid()
  )
);

insert into public.plans (
  code, name, description, price_monthly, price_annual, currency_code,
  max_seats, max_leads_per_month, max_ai_interactions_per_month,
  features, is_public, is_active, position
)
values
  (
    'free', 'Free', 'Try the core CRM with limited AI usage.',
    0, 0, 'USD', 2, 50, 20,
    '["Lead intake + classification","Basic pipeline","1 workspace"]'::jsonb,
    true, true, 0
  ),
  (
    'starter', 'Starter',
    'For solo founders and small teams getting serious about lead follow-up.',
    29, 290, 'USD', 5, 500, 300,
    '["Everything in Free","AI Copilot","Weekly AI reports","Follow-up automation"]'::jsonb,
    true, true, 1
  ),
  (
    'pro', 'Pro',
    'For growing teams that want the full automation + AI memory stack.',
    79, 790, 'USD', 15, 3000, 1500,
    '["Everything in Starter","AI memory / RAG copilot","Custom fields","Saved views","Priority support"]'::jsonb,
    true, true, 2
  ),
  (
    'white_label', 'White-Label / Custom',
    'Dedicated deploy for agencies/consultants reselling this CRM to their own clients.',
    null, null, 'USD', null, null, null,
    '["Your own Supabase + n8n instance","Full customization","Source handover option"]'::jsonb,
    false, true, 3
  )
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  price_monthly = excluded.price_monthly,
  price_annual = excluded.price_annual,
  currency_code = excluded.currency_code,
  max_seats = excluded.max_seats,
  max_leads_per_month = excluded.max_leads_per_month,
  max_ai_interactions_per_month = excluded.max_ai_interactions_per_month,
  features = excluded.features,
  is_public = excluded.is_public,
  is_active = excluded.is_active,
  position = excluded.position,
  updated_at = now();
