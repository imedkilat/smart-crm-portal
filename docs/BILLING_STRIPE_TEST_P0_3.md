# Billing P0-3 — Stripe Test-Mode Foundation

## Scope

Billing P0-3 adds a source-controlled, test-only Stripe integration layer on top of the existing P0-1 entitlement/quota enforcement and P0-2 provider semantics.

This phase adds:

- authenticated Checkout Session creation for Starter/Pro monthly or annual plans;
- authenticated Stripe Customer Portal Session creation for existing Stripe-managed workspaces;
- a signed Stripe webhook endpoint for subscription lifecycle synchronization;
- explicit Edge Function JWT boundaries in `supabase/config.toml`;
- a source-safety verifier and Deno type-check CI gate.

This phase does **not**:

- configure Stripe secrets in production;
- create Stripe Products or Prices;
- write Stripe Product/Price IDs into `public.plans`;
- deploy the new Edge Functions;
- enable live mode;
- create a real customer subscription;
- enable outbound email or Follow-Up business writes;
- change the existing Free or manually provisioned Starter subscription.

Real charges remain **NO-GO**.

## Production baseline before rollout

Production already contains:

- Billing P0-1 entitlement and atomic usage enforcement;
- the Follow-Up QA entitlement-bypass preservation migration;
- Billing P0-2 `billing_provider` semantics;
- the guarded `crm-lead-intake`, `crm-ai-copilot`, and `crm-status-route` Edge Function versions.

Current subscription provider distribution is expected to remain:

- normal Free self-signup workspaces → `billing_provider=none`;
- manually provisioned paid workspace(s) → `billing_provider=manual`;
- Stripe-managed workspaces → none until controlled test-mode Checkout is explicitly enabled.

Current Stripe plan mapping is intentionally empty. Checkout fails closed until the selected active public plan contains server-trusted Stripe test Product and Price IDs.

## Test-only safety boundary

All three billing functions require:

- `STRIPE_BILLING_MODE=test`;
- a Stripe secret key beginning with `sk_test_` or `rk_test_`.

The webhook additionally requires `STRIPE_WEBHOOK_SECRET` and rejects every verified event where `event.livemode === true`.

This means accidentally supplying a live Stripe key/event is not enough to activate live billing in P0-3. A later live cutover must intentionally remove this test-only gate in a separate reviewed change.

The Stripe server SDK is pinned exactly to `npm:stripe@22.6.0` so a future dependency release cannot silently change the billing runtime.

## Checkout authorization and trust model

`crm-billing-checkout` remains JWT-protected and revalidates the caller server-side.

Requirements:

1. caller must have a valid Supabase user session;
2. caller must be `owner` or `admin` of the requested workspace;
3. requested plan must be an active, public `starter` or `pro` plan;
4. requested billing cycle must be `monthly` or `annual`;
5. Stripe Product/Price IDs are loaded from trusted `public.plans` fields;
6. client-supplied Stripe Product/Price IDs are never accepted;
7. manually billed subscriptions cannot be silently converted;
8. an existing Stripe billing relationship cannot create a second Checkout path;
9. the pre-Checkout local subscription must be the canonical Free plan with `billing_provider=none`, `billing_cycle=none`, and no Stripe identity;
10. an `x-idempotency-key` is required and forwarded to Stripe as a workspace-scoped idempotency key.

Before creating a Checkout Session, the server retrieves the configured Stripe Price and validates it against the local sellable plan. It fails closed unless:

- the Price is active;
- the Price belongs to the mapped Stripe Product;
- local and Stripe currency are both the supported USD billing currency;
- Stripe `unit_amount` exactly matches the local monthly/annual plan amount;
- the recurring interval is exactly one month or one year for the selected cycle;
- recurring usage type is `licensed`.

This prevents a stale or accidentally mis-mapped `price_...` ID from silently creating a Checkout for the wrong test Product, amount, currency, or billing interval.

Checkout does **not** mutate the local subscription before payment. The workspace stays on its existing local entitlement until a signed Stripe webhook confirms the Stripe subscription. This prevents an abandoned Checkout Session from downgrading or corrupting the current workspace state.

A deterministic, server-derived `billing_request_id` is added to Checkout/subscription metadata. After Stripe returns the Checkout Session but **before** the session URL is exposed to the caller, Smart CRM records a minimized `stripe_checkout.request_created` row in the existing `billing_events` audit ledger. The row is `billing_provider=none` with no `stripe_event_id`, because it represents a local Checkout authorization request rather than a Stripe webhook event.

If that local audit write fails, the function does not return the Checkout URL and no local entitlement changes. Retrying the same workspace-scoped idempotency key produces the same deterministic billing request ID and Stripe idempotency key.

Checkout metadata carries only trusted routing/audit identifiers:

- `workspace_id`;
- `plan_code`;
- `billing_cycle`;
- `requested_by`;
- `billing_request_id`.

The same metadata is attached to `subscription_data` so initial subscription events can be tenant-resolved and matched to the server-created Checkout audit without trusting browser state.

Success/cancel URLs are server-controlled Smart CRM URLs rather than arbitrary client return URLs.

## Customer Portal authorization

`crm-billing-portal` remains JWT-protected and requires workspace `owner` or `admin` role.

It only creates a Portal Session when the local subscription is already:

- `billing_provider=stripe`; and
- carrying a server-stored `stripe_customer_id`.

The browser cannot provide a Stripe Customer ID.

## Webhook authentication and idempotency

`stripe-billing-webhook` intentionally has `verify_jwt=false` because Stripe does not send a Supabase user JWT.

The function authenticates Stripe by:

1. reading the raw body with `req.text()`;
2. reading `Stripe-Signature`;
3. validating the signature with `stripe.webhooks.constructEventAsync(...)` and `STRIPE_WEBHOOK_SECRET`;
4. rejecting verified live-mode events during P0-3.

Every verified Stripe event is first represented in `public.billing_events` using the unique `stripe_event_id`.

The stored webhook payload is a minimized audit envelope rather than the full Stripe payload, reducing billing/customer PII retention. It contains only event/object identifiers, type, creation timestamp, and livemode state.

Replay behavior:

- a previously processed `stripe_event_id` returns success as a duplicate;
- a previously inserted but unprocessed/failed event is eligible for retry;
- processing failures keep `processed_at=null`, store a bounded error marker, and return HTTP 500 so Stripe can retry.

## Subscription lifecycle sync

P0-3 handles:

- `checkout.session.completed`;
- `checkout.session.async_payment_succeeded`;
- `customer.subscription.created`;
- `customer.subscription.updated`;
- `customer.subscription.deleted`;
- `invoice.paid`;
- `invoice.payment_failed`.

The webhook resolves the authoritative plan from the Stripe subscription Price ID against the server-stored plan mapping. It does not trust event metadata alone to choose the plan.

Only Starter/Pro Price mappings are accepted by the self-service Stripe path. A valid Smart CRM subscription must contain exactly one subscription item with quantity `1`. The subscription's actual Stripe Price is checked against the mapped Product, USD amount, recurring interval/count, and licensed usage type before local billing state is updated. Unlike Checkout creation, webhook lifecycle sync does not require the Price to remain active because an existing subscription may legitimately reference a later-archived Price during cancellation or recovery processing.

Before the first `billing_provider=none` → Stripe transition, the webhook additionally requires the server-created `stripe_checkout.request_created` audit identified by `billing_request_id`. Its workspace, plan, cycle, and requester must match the signed Stripe subscription metadata and the server-side Price mapping. A Stripe subscription created outside Smart CRM cannot grant paid entitlement merely by carrying a workspace ID or hand-authored metadata.

Before updating a workspace subscription, the webhook also:

- resolves the workspace from trusted initial subscription metadata or an existing Stripe identity;
- rejects cross-workspace reuse of a Stripe Customer or Subscription ID;
- refuses to overwrite `billing_provider=manual` without a future explicit conversion flow;
- verifies an existing Stripe identity still matches the same workspace.

Once `billing_provider=stripe`, the current Stripe subscription Price becomes plan/cycle authority. This deliberately avoids treating the original Checkout metadata as permanent plan state, so a future legitimate Customer Portal upgrade/downgrade is not rejected merely because the original metadata is stale.

For `customer.subscription.created` and `customer.subscription.updated`, the handler re-fetches the current subscription from Stripe before syncing. This reduces the risk that a delayed older event rolls the local mirror backward. The deletion event uses its terminal event object so cancellation sync does not depend on post-deletion retrieval behavior.

Stripe status is normalized into the existing local status vocabulary. `unpaid` becomes `past_due`; `incomplete_expired` becomes `canceled`.

## Explicit function auth configuration

`supabase/config.toml` records:

- `crm-billing-checkout` → `verify_jwt=true`;
- `crm-billing-portal` → `verify_jwt=true`;
- `stripe-billing-webhook` → `verify_jwt=false` because Stripe signature verification is performed in-handler;
- existing `crm-outbound-email` → `verify_jwt=false`, preserving its current custom-token boundary.

## Source validation

PR CI runs:

```text
node --check scripts/verify-stripe-test-foundation.mjs
node scripts/verify-stripe-test-foundation.mjs
deno check --node-modules-dir=auto supabase/functions/crm-billing-checkout/index.ts
deno check --node-modules-dir=auto supabase/functions/crm-billing-portal/index.ts
deno check --node-modules-dir=auto supabase/functions/stripe-billing-webhook/index.ts
```

The static safety contract verifies test-key guards, canonical Free starting state, server-trusted Product/Price lookup, exact amount/currency/interval validation, trusted Checkout activation auditing, single-item subscription shape, owner/admin billing authorization, webhook raw-body signature verification, replay handling, minimized event payloads, lifecycle tenant guards, and explicit function JWT settings.

## Controlled test-mode rollout order

Do not perform these steps merely because this source PR is merged.

1. Reconfirm production migration/provider baseline.
2. In a Stripe **test/sandbox** environment, create or identify the intended Starter/Pro Products and monthly/annual Prices.
3. Verify Product identity, Price amount, USD currency, recurring interval/count, and licensed usage type in Stripe before saving any IDs.
4. Populate only the matching test Product/Price IDs in `public.plans` through an approval-gated server/admin operation.
5. Configure `STRIPE_BILLING_MODE=test`, the test secret key, and the webhook signing secret as Supabase secrets. Never expose them to the browser or repository.
6. Deploy `crm-billing-checkout` and `crm-billing-portal` with JWT verification enabled.
7. Deploy `stripe-billing-webhook` with JWT verification disabled exactly as declared in config.
8. Register the Stripe test webhook endpoint for the supported lifecycle events.
9. Run controlled Checkout using a dedicated QA Free workspace only.
10. Confirm Checkout creates a local `stripe_checkout.request_created` audit but does not change the local Free subscription.
11. Complete payment with a Stripe test payment method.
12. Confirm signed webhook sync transitions only the QA workspace to `billing_provider=stripe` and the expected Starter/Pro plan.
13. Confirm a signed test subscription with no matching Smart CRM Checkout audit is rejected and does not grant entitlement.
14. Replay the same event and confirm no duplicate state mutation.
15. Exercise subscription update/cancel/payment-failure scenarios, including delayed-event ordering where practical and Stripe test clocks where appropriate.
16. Confirm Customer Portal can only be opened by an owner/admin of the Stripe-managed QA workspace.
17. Re-run entitlement/quota, tenant-isolation, and billing provider regression checks.
18. Keep live Stripe mode disabled.

## Remaining blockers before real charges

P0-3 source completion is not commercial billing launch approval. Remaining gates include at minimum:

- controlled Stripe test Product/Price mapping and deployed test secrets;
- successful end-to-end test-mode Checkout/webhook/Portal QA;
- explicit seat-limit enforcement for `max_seats`;
- safe handling of plan upgrades/downgrades and proration policy;
- explicit Stripe Customer Portal configuration/policy for permitted plan changes and cancellations;
- versioned Stripe Price mapping / grandfathering policy before changing commercial plan prices;
- explicit migration policy for manually billed customers;
- billing-endpoint abuse/rate-limit policy before live self-service exposure;
- durable reconciliation/recovery for missed or out-of-order Stripe events beyond event-time re-fetch protection;
- final security/advisor review;
- a separate live-mode cutover PR and explicit owner approval.

Until those gates pass, Stripe live charges remain **NO-GO**.
