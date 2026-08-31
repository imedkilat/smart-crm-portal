# Outbound Follow-Up Email Engine

## Goal

Extend Smart CRM's internal Follow-Up Engine into a separately gated customer-email channel without weakening tenant isolation, idempotency, entitlement, branding, or auditability.

This engine is intentionally separate from:

- internal `lead_tasks` follow-up automation;
- Quote Follow-Up internal Slack/email alerts;
- Supabase Auth email delivery.

## Existing primitives reused

The outbound channel does not duplicate existing CRM data models.

It reuses:

- `message_templates` for workspace-scoped subject/body templates and versions;
- `workspace_branding` for company name, sender name, reply-to email, website and email signature;
- `subscriptions` + `plans` for entitlement;
- `leads` for the recipient identity;
- `lead_activities` for successful live-send audit events.

## New foundation

### `workspace_outbound_email_settings`

One row per workspace.

Default state:

- `enabled = false`
- `mode = disabled`
- no provider
- max 1 email per run
- max 20 emails per UTC day

Modes:

- `disabled` — dispatch is rejected;
- `simulate` — render and log the email, but do not call a provider;
- `live` — provider delivery may occur only if the server-side adapter and secrets are configured.

`enabled`, `mode`, and `provider` are server-owned launch controls. Authenticated workspace owners/admins may read the row and may tune pause/cap fields, but cannot enable live customer email directly from the browser.

### `outbound_email_deliveries`

One row per logical customer email.

Important properties:

- tenant-scoped `(workspace_id, lead_id)` relationship;
- tenant-scoped template relationship through `(workspace_id, template_key)`;
- unique `(workspace_id, idempotency_key)` duplicate guard;
- rendered recipient, subject and body snapshot;
- simulate/live mode;
- provider and provider message ID;
- status timestamps and failure fields;
- browser read-only access.

Delivery states:

- `prepared`
- `simulated`
- `sending`
- `sent`
- `delivered`
- `bounced`
- `failed`
- `cancelled`

### `outbound_email_attempts`

Append-only attempt history for a logical delivery.

Records:

- attempt number;
- mode;
- provider;
- simulated/sent/failed result;
- HTTP status when applicable;
- provider message ID;
- provider response metadata;
- error code/message;
- attempt timestamp.

Authenticated users can read tenant rows. Automation may insert attempts; browser clients cannot mutate them.

## Dispatcher Edge Function

`supabase/functions/crm-outbound-email/index.ts`

The dispatcher is server-to-server only and requires a dedicated `OUTBOUND_EMAIL_INGRESS_TOKEN`.

The caller supplies only trusted lookup identifiers:

```json
{
  "workspace_id": "...",
  "lead_public_id": "ld_...",
  "template_key": "hot-follow-up",
  "idempotency_key": "followup:ld_xxx:2026-08-31"
}
```

The caller does **not** supply recipient, subject, body, branding or provider credentials.

The function resolves those server-side and verifies:

1. workspace outbound settings exist;
2. outbound is enabled and not paused;
3. mode is not disabled;
4. workspace has an active/trialing entitled Starter/Pro/White Label subscription;
5. UTC-day cap is not exceeded;
6. the lead belongs to the workspace and has an email;
7. the template belongs to the same workspace, is email-channel and enabled;
8. branding exists;
9. template variables are valid;
10. `(workspace_id, idempotency_key)` has not already been used.

## Template rendering

The dispatcher supports the same variable contract as the Message Templates UI:

- `lead.first_name`
- `lead.name`
- `lead.company`
- `lead.email`
- `lead.routing_status`
- `workspace.company_name`
- `workspace.website_url`
- `workspace.sender_name`
- `workspace.reply_to_email`
- `workspace.email_signature`

Unknown or malformed variables fail closed before a delivery is reserved.

## Simulation mode

Simulation mode is the first production QA target.

When one controlled workspace is set to:

```text
enabled = true
mode = simulate
```

the dispatcher:

1. resolves the real tenant-scoped lead/template/branding;
2. renders the subject/body;
3. inserts one `outbound_email_deliveries` row;
4. inserts one `outbound_email_attempts` row with `status=simulated`;
5. marks the delivery `simulated`;
6. returns `network_call_performed=false`;
7. performs **no provider HTTP request** and writes no `outbound_email_sent` lead activity.

Repeating the same idempotency key returns the existing delivery and does not create a second logical send.

## Live provider adapter

The first implemented adapter is `resend`, behind the provider abstraction.

Live mode additionally requires server secrets:

- `RESEND_API_KEY`
- `OUTBOUND_EMAIL_FROM`

`OUTBOUND_EMAIL_FROM` must be a verified sender address/domain before live QA.

The visible sender name comes from `workspace_branding.sender_name`, falling back to the workspace company name. `workspace_branding.reply_to_email` is used as Reply-To when present.

No live provider request is possible while workspace settings remain disabled/simulate or while required secrets are absent.

## Delivery / bounce events

The schema already models `delivered` and `bounced`, but provider webhook ingestion should be implemented and QA'd only after the actual live provider/domain is selected and verified. Do not pretend those terminal states are automated before that webhook gate exists.

## Rollout gates

### Gate 1 — Source review

- migration + hardening migration reviewed;
- dispatcher reviewed;
- no production DDL;
- no function deployment;
- Vercel/repo checks green.

### Gate 2 — Production schema apply

- apply only outbound foundation migrations;
- verify one disabled settings row per workspace;
- verify delivery/attempt tables empty;
- verify RLS/grants/triggers;
- verify zero lead/task/activity mutations.

### Gate 3 — Deploy dispatcher with send-disabled secret setup

- configure dedicated `OUTBOUND_EMAIL_INGRESS_TOKEN`;
- deploy `crm-outbound-email`;
- leave all workspaces disabled;
- raw unauthorized request must fail.

### Gate 4 — One-workspace simulation QA

- select one controlled entitled QA workspace;
- server-set `enabled=true`, `mode=simulate`;
- use one controlled lead with an email and one enabled template;
- execute exactly one logical email;
- verify one delivery + one simulated attempt;
- verify `network_call_performed=false`;
- repeat same idempotency key and prove no duplicate;
- restore workspace to disabled unless further QA is approved.

### Gate 5 — Render/content QA

- inspect rendered subject/body;
- verify correct tenant branding and Reply-To data;
- verify no cross-workspace template/branding leakage;
- verify no malformed or unknown template variables.

### Gate 6 — Provider/domain setup

Requires a separately chosen/verified provider and sending identity.

For a future Smart CRM product domain, a dedicated customer-email subdomain should be considered separately from Auth mail. Do not reuse Auth sender reputation by default.

### Gate 7 — One real email

Requires explicit outbound-send approval.

- one controlled workspace;
- one controlled recipient;
- `mode=live` set server-side;
- provider/from secrets present;
- exactly one email;
- verify provider ID, delivery ledger, attempt log and lead activity;
- prove idempotency before any scheduled automation is enabled.

### Gate 8 — Provider event webhook

- verify provider webhook signature;
- map delivered/bounced/complaint events to the correct tenant-scoped delivery;
- log provider events safely;
- test bounce/failure recovery.

### Gate 9 — Canary automation

Only after all prior gates pass should n8n be allowed to dispatch live customer emails on schedule.

## Explicitly not automatic yet

- no current production migration;
- no current Edge Function deployment;
- no current live provider credentials;
- no verified customer-email sender/domain;
- no customer email sends;
- no provider webhook ingestion;
- no scheduled outbound-email n8n activation.
