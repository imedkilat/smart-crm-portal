# Billing P0-2 — Provider Semantics

## Scope

Billing P0-2 makes the billing lifecycle authority explicit without enabling Stripe.

Supported provider values:

- `none` — unbilled subscription state, including normal Free self-signup.
- `manual` — subscription lifecycle managed administratively / by invoice rather than Stripe.
- `stripe` — future Stripe-managed subscription lifecycle.

This phase does **not** add Checkout, Customer Portal, webhook ingestion, Stripe secrets, Price mappings, or live charges.

## Subscription invariants

`public.subscriptions.billing_provider` is non-null and restricted to `none | manual | stripe`.

- `stripe` requires both `stripe_customer_id` and `stripe_subscription_id`.
- `none` and `manual` require both Stripe identity fields to be null.
- Existing rows are backfilled conservatively:
  - rows already carrying a Stripe identity become `stripe`;
  - `billing_cycle = 'none'` becomes `none`;
  - other existing paid/custom rows become `manual`.

A database trigger normalizes newly inserted/updated rows:

- any Stripe identity makes the row `stripe`;
- an unbilled `billing_cycle = 'none'` row remains `none`;
- monthly/annual/custom rows without Stripe identity become `manual` unless already explicitly manual.

This preserves the existing admin provisioning flow without requiring browser or Edge Function changes.

## Billing-event invariants

`public.billing_events.billing_provider` is also restricted to `none | manual | stripe`.

- Stripe events require a non-null `stripe_event_id`.
- Non-Stripe events cannot carry a `stripe_event_id`.
- `manual_provisioning.*` events are normalized to `manual`.
- Any event with `stripe_event_id` is normalized to `stripe`.

The existing unique `stripe_event_id` remains the future Stripe webhook idempotency primitive.

## Production expectations after rollout

With the current production data, the expected backfill is:

- normal Free self-signup subscriptions → `none`
- manually provisioned Starter subscription → `manual`
- Stripe subscriptions → none currently exist
- existing `manual_provisioning.*` billing events → `manual`
- Stripe billing events → none currently exist

## Validation checklist

Before production rollout:

1. Confirm the migration is the only schema change in the PR.
2. Confirm existing subscriptions contain no partial Stripe identity.
3. Confirm current manually provisioned paid subscription(s) will backfill to `manual`.
4. Confirm Free subscriptions with `billing_cycle='none'` will backfill to `none`.
5. Confirm the three existing manual provisioning billing events will backfill to `manual`.
6. Confirm constraints reject:
   - unknown provider values;
   - `stripe` without both Stripe identity fields;
   - `manual`/`none` with Stripe identity fields;
   - Stripe billing events without `stripe_event_id`;
   - non-Stripe billing events carrying `stripe_event_id`.
7. Re-run Supabase security advisors after migration.

## Rollout order

1. Merge the reviewed migration to `main`.
2. Verify Supabase migration application.
3. Read back provider distribution and constraints.
4. Verify existing Free/Starter entitlements still return the same P0-1 results.
5. Keep outbound email disabled.
6. Keep Stripe configuration empty.

## Next phase

Billing P0-3 may introduce server-trusted Stripe Product/Price mappings and Checkout/customer creation. Before doing so, Stripe-specific code must only mutate subscriptions whose `billing_provider` is `stripe` (or explicitly transition a row into that state with both Stripe identity fields present).

Real charges remain **NO-GO** until Checkout, signed webhook processing, lifecycle synchronization, Customer Portal, and test-mode E2E are complete and explicitly approved for live-mode cutover.
