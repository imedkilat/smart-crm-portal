-- Billing P0-2: explicit billing-provider semantics.
--
-- This migration does NOT configure Stripe, create Checkout sessions, ingest
-- webhooks, or enable charges. It only makes subscription/event ownership
-- explicit so unbilled, manually managed, and future Stripe-managed billing
-- state can coexist without ambiguity.

alter table public.subscriptions
  add column if not exists billing_provider text;

alter table public.billing_events
  add column if not exists billing_provider text;

-- Backfill current subscription ownership conservatively:
-- - Stripe IDs already present => Stripe-managed.
-- - No billing cycle => unbilled / no provider.
-- - Any other existing paid/custom lifecycle => manually managed.
update public.subscriptions s
set billing_provider = case
  when s.stripe_customer_id is not null
    or s.stripe_subscription_id is not null then 'stripe'
  when s.billing_cycle = 'none' then 'none'
  else 'manual'
end
where s.billing_provider is null;

-- Existing manual provisioning audit rows become explicitly manual. Future
-- Stripe webhook rows will be classified from stripe_event_id at the DB edge.
update public.billing_events e
set billing_provider = case
  when e.stripe_event_id is not null then 'stripe'
  when e.event_type like 'manual_provisioning.%' then 'manual'
  else 'none'
end
where e.billing_provider is null;

alter table public.subscriptions
  alter column billing_provider set default 'none',
  alter column billing_provider set not null;

alter table public.billing_events
  alter column billing_provider set default 'none',
  alter column billing_provider set not null;

alter table public.subscriptions
  drop constraint if exists subscriptions_billing_provider_check;
alter table public.subscriptions
  add constraint subscriptions_billing_provider_check
  check (billing_provider in ('none', 'manual', 'stripe'));

alter table public.subscriptions
  drop constraint if exists subscriptions_billing_provider_stripe_identity_check;
alter table public.subscriptions
  add constraint subscriptions_billing_provider_stripe_identity_check
  check (
    (
      billing_provider = 'stripe'
      and stripe_customer_id is not null
      and stripe_subscription_id is not null
    )
    or (
      billing_provider in ('none', 'manual')
      and stripe_customer_id is null
      and stripe_subscription_id is null
    )
  );

alter table public.billing_events
  drop constraint if exists billing_events_billing_provider_check;
alter table public.billing_events
  add constraint billing_events_billing_provider_check
  check (billing_provider in ('none', 'manual', 'stripe'));

alter table public.billing_events
  drop constraint if exists billing_events_billing_provider_stripe_event_check;
alter table public.billing_events
  add constraint billing_events_billing_provider_stripe_event_check
  check (
    (billing_provider = 'stripe' and stripe_event_id is not null)
    or (billing_provider in ('none', 'manual') and stripe_event_id is null)
  );

-- Normalize provider semantics at the authoritative database boundary. This
-- keeps existing onboarding code safe: self-signup Free has billing_cycle=none
-- and remains provider=none; manually provisioned monthly/annual/custom rows
-- become provider=manual. Stripe identity cannot be half-configured.
create or replace function private.normalize_subscription_billing_provider()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stripe_customer_id is not null
     or new.stripe_subscription_id is not null then
    new.billing_provider := 'stripe';
  elsif new.billing_provider is null or new.billing_provider = 'none' then
    if new.billing_cycle = 'none' then
      new.billing_provider := 'none';
    else
      new.billing_provider := 'manual';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_subscription_billing_provider()
  from public, anon, authenticated;

drop trigger if exists trg_subscriptions_billing_provider
  on public.subscriptions;
create trigger trg_subscriptions_billing_provider
before insert or update of
  billing_provider,
  billing_cycle,
  stripe_customer_id,
  stripe_subscription_id
on public.subscriptions
for each row execute function private.normalize_subscription_billing_provider();

create or replace function private.normalize_billing_event_provider()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stripe_event_id is not null then
    new.billing_provider := 'stripe';
  elsif new.event_type like 'manual_provisioning.%' then
    new.billing_provider := 'manual';
  elsif new.billing_provider is null then
    new.billing_provider := 'none';
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_billing_event_provider()
  from public, anon, authenticated;

drop trigger if exists trg_billing_events_billing_provider
  on public.billing_events;
create trigger trg_billing_events_billing_provider
before insert or update of billing_provider, stripe_event_id, event_type
on public.billing_events
for each row execute function private.normalize_billing_event_provider();

create index if not exists idx_subscriptions_billing_provider_status
  on public.subscriptions (billing_provider, status);

create index if not exists idx_billing_events_provider_created
  on public.billing_events (billing_provider, created_at desc);

comment on column public.subscriptions.billing_provider is
  'Lifecycle authority for this subscription: none (unbilled), manual (admin/invoice managed), or stripe (Stripe-managed).';

comment on column public.billing_events.billing_provider is
  'Billing system associated with the event: none, manual, or stripe.';

comment on table public.subscriptions is
  'Current subscription state per workspace. billing_provider identifies the lifecycle authority; Stripe is authoritative only for rows where billing_provider=stripe.';

comment on table public.billing_events is
  'Provider-aware billing audit and idempotency ledger. Manual events may omit stripe_event_id; Stripe webhook events require one.';
