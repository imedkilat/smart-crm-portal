-- Keep the billing event ledger machine-only at the Postgres grant layer.
--
-- RLS already fails closed because billing_events intentionally has no user
-- policies. However, authenticated previously retained broad table privileges,
-- which made the ledger discoverable through the Data API / GraphQL schema.
-- Stripe webhooks and billing Edge Functions use service_role, while
-- SECURITY DEFINER onboarding runs as its function owner, so browser clients do
-- not need direct access to this table.

alter table public.billing_events enable row level security;

revoke all privileges on table public.billing_events from public;
revoke all privileges on table public.billing_events from anon;
revoke all privileges on table public.billing_events from authenticated;

grant all privileges on table public.billing_events to service_role;

comment on table public.billing_events is
  'Machine-only billing audit/idempotency ledger. Browser roles have no direct table privileges; trusted server paths use service_role or SECURITY DEFINER ownership.';

-- Fail the migration if the intended boundary is not effective.
do $$
begin
  if has_table_privilege('anon', 'public.billing_events', 'SELECT') then
    raise exception 'billing_events must not be readable by anon';
  end if;

  if has_table_privilege('authenticated', 'public.billing_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.billing_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.billing_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.billing_events', 'DELETE') then
    raise exception 'billing_events must not be directly accessible to authenticated';
  end if;

  if not has_table_privilege('service_role', 'public.billing_events', 'SELECT')
     or not has_table_privilege('service_role', 'public.billing_events', 'INSERT')
     or not has_table_privilege('service_role', 'public.billing_events', 'UPDATE')
     or not has_table_privilege('service_role', 'public.billing_events', 'DELETE') then
    raise exception 'billing_events service_role access must remain intact';
  end if;
end
$$;
