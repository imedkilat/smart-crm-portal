# Billing P0-1 — Entitlement and Usage Enforcement

## Scope

This gate makes the existing Smart CRM subscription state authoritative before any Stripe checkout, webhook, or real charge is enabled.

It does **not** configure Stripe and does **not** enable payments.

## Machine entitlements

`plans.entitlements` stores server-readable feature flags separate from human-facing plan copy.

| Entitlement | Free | Starter | Pro | White-label |
| --- | --- | --- | --- | --- |
| `lead_intake` | yes | yes | yes | yes |
| `ai_copilot` | yes | yes | yes | yes |
| `follow_up_automation` | no | yes | yes | yes |
| `outbound_email` | no | yes | yes | yes |

Existing monthly limits remain authoritative:

- Free: 50 leads / 20 AI interactions
- Starter: 500 leads / 300 AI interactions
- Pro: 3,000 leads / 1,500 AI interactions
- White-label: unlimited when the corresponding limit is NULL

## Enforcement model

### Read-only preflight

The service-role-only `check_workspace_entitlement(workspace_id, entitlement_key)` RPC resolves:

- active plan
- subscription status
- machine entitlement
- current calendar-month usage
- plan limit and remaining quota

The AI Copilot and Lead Intake Edge Functions preflight this RPC before calling n8n. Status routing also requires `follow_up_automation` before invoking routing automation.

### Authoritative database boundary

Preflight is not trusted as the final quota decision. Durable writes enforce the same rules transactionally:

- `leads` INSERT consumes one `leads_created` unit
- `ai_interactions` INSERT consumes one `ai_interactions` unit
- production Follow-Up Engine task INSERT requires `follow_up_automation`
- outbound email delivery INSERT requires `outbound_email`

Monthly quota consumption uses an advisory transaction lock per workspace + metric + month, preventing concurrent requests from racing past the limit.

Controlled `follow-up:qa:v1:*` tasks retain the existing QA-only paid-plan bypass. Production `follow-up:v1:*` tasks do not.

## Migration safety

Before the gates are installed:

1. Any legacy workspace missing a subscription receives Free only. Existing subscriptions are never overwritten.
2. Current-month lead and AI counters are seeded from durable rows.
3. Existing counter values are never reduced by the seed.

## Production rollout order

1. Merge the source branch.
2. Run the Supabase migration dry-run.
3. Apply both billing P0-1 migrations.
4. Verify `check_workspace_entitlement` is executable by `service_role` only.
5. Deploy `crm-lead-intake`, `crm-ai-copilot`, and `crm-status-route` with JWT verification enabled.
6. Keep Stripe unconfigured and real charges disabled.
7. Run controlled entitlement QA before enabling any additional commercial gate.

## Required QA

### Free workspace

- Lead intake succeeds below 50 current-month leads.
- AI Copilot succeeds below 20 current-month interactions.
- Follow-up production automation is denied.
- Outbound email delivery creation is denied.
- Manual human-created tasks still work.

### Starter workspace

- Lead intake succeeds below 500 current-month leads.
- AI Copilot succeeds below 300 current-month interactions.
- Follow-up production automation is allowed when its separate workspace settings and safety switches allow it.
- Outbound email remains subject to its existing enabled/mode/daily-cap controls.

### Subscription state

For any plan, `past_due`, `canceled`, `incomplete`, or `paused` must fail closed for paid automation and metered operations.

### Quota boundary

At the exact limit:

- the Edge preflight returns quota exhaustion before a new n8n request when the counter already reflects the limit;
- a direct/concurrent durable INSERT still cannot push the counter beyond the plan limit;
- failed INSERT transactions do not permanently consume quota.

## Remaining billing blockers

This gate intentionally leaves these for later P0 work:

- Stripe Product/Price creation and mapping
- Stripe Checkout
- Stripe Customer Portal
- signed Stripe webhook ingestion and lifecycle sync
- explicit `billing_provider` semantics for Stripe vs manual vs none
- seat-limit enforcement when team invitation/member-management ships
- billing-specific UI and upgrade/downgrade flows

Real charges remain a NO-GO until those gates and Stripe test-mode E2E pass.
