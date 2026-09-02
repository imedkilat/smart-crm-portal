# Billing scheduled changes P0-5

## Scope

This gate adds TEST-MODE-only scheduled plan and billing-cycle changes for existing Stripe-managed Smart CRM subscriptions.

It does not enable Stripe live mode, real charges, Portal plan switching, outbound email delivery, or Follow-Up writes.

## Policy

- Starter -> Pro on the same billing cycle remains an immediate prorated upgrade handled by `crm-billing-change-plan`.
- Pro -> Starter is scheduled for the current renewal boundary.
- Any monthly <-> annual billing-cycle change is scheduled for the current renewal boundary.
- Scheduled phase transitions use no proration.
- The current plan, entitlement, and billing cycle remain authoritative until Stripe transitions into the future phase.
- The future phase uses `billing_cycle_anchor=phase_start` so monthly/annual changes begin cleanly at renewal.
- Subscription Schedule `end_behavior=release` keeps the underlying subscription running after the schedule completes.

## Safety boundaries

`crm-billing-schedule-change` requires:

- a valid authenticated Supabase session,
- workspace owner/admin membership,
- `STRIPE_BILLING_MODE=test`,
- an `sk_test_` or `rk_test_` Stripe key,
- an active Stripe-managed local subscription,
- matching Stripe customer/subscription identity,
- exactly one licensed subscription item with quantity 1,
- no scheduled cancellation or pending Stripe update,
- no existing Subscription Schedule,
- validated local Product/Price/currency/amount/interval mappings.

Discounted, taxed, automatic-tax, trial, paused-collection, and non-automatic-charge subscriptions fail closed for administrator review instead of silently dropping billing attributes while building a schedule.

## Seat-limit behavior

The scheduling reservation is atomic with workspace-member seat writes by using the same advisory lock as the membership trigger.

Before a lower-seat target plan is reserved:

1. current workspace membership is checked against the target plan cap;
2. if the workspace is already over the target cap, scheduling is rejected;
3. while the scheduled request is `processing` or `scheduled`, new seat additions use the stricter of the current plan cap and the future target cap;
4. existing members are never automatically removed.

This prevents a workspace from scheduling a valid downgrade and then growing beyond the future plan limit before renewal.

## Stripe schedule lifecycle

Scheduling uses two Stripe API steps:

1. create a Subscription Schedule with `from_subscription`;
2. update it with the current phase through the existing period end plus one future phase using the requested Price.

The future phase stores Smart CRM request metadata and uses `proration_behavior=none`.

If schedule creation succeeds but later verification/finalization fails, the function attempts to `release` the schedule immediately. A cleanup failure returns a reconciliation-required error rather than claiming the current billing state is safe.

## Canceling a scheduled change

The same Edge Function supports `action=cancel`.

Canceling a pending Smart CRM change calls Stripe Subscription Schedule `release`, which removes future scheduling while leaving the subscription itself active. The local request is then marked `canceled`.

## Reconciliation

The Stripe webhook remains authoritative for the actual subscription Price and billing cycle.

A database trigger observes trusted updates to `subscriptions.plan_id` / `billing_cycle`. When the values match the active scheduled request target, that request is marked `applied`.

No entitlement is granted early simply because a schedule exists.

## Test plan

Before any live billing consideration:

1. Schedule Pro monthly -> Starter monthly on the low-risk `From` TEST workspace.
2. Confirm Stripe keeps the current Pro Price until renewal and attaches an active Subscription Schedule.
3. Confirm the local subscription remains Pro/monthly while the request is `scheduled`.
4. Confirm pending Starter cap blocks seat additions above Starter's limit.
5. Release/cancel the schedule and confirm the current Pro subscription remains unchanged.
6. Re-schedule and exercise the future phase using a safe Stripe test-clock or controlled test technique when available.
7. Confirm webhook/local plan sync and request reconciliation to `applied`.
8. Repeat one monthly -> annual schedule path.
9. Keep Stripe live mode disabled throughout P0-5 QA.
