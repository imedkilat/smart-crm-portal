# Quote Follow-Up Alerts + Sales Recovery Engine

## Goal

Turn a sent quote into a structured sales-recovery workflow without mixing internal team alerts with customer-facing outbound messaging.

The first version should answer four questions reliably:

1. Which quote was sent to which lead?
2. Has receipt been confirmed?
3. What internal follow-up action is due next?
4. Which alert was attempted, through which channel, and what happened?

## Product boundary

This feature is an **internal sales-operations layer**.

It may:
- record quote lifecycle state;
- create CRM tasks;
- write lead timeline activities;
- queue/log internal alerts;
- record acknowledgement and call outcomes.

It must not, in this foundation:
- send customer email or SMS;
- store provider secrets in browser-readable tables;
- activate Slack/email delivery automatically;
- duplicate the existing generic Follow-Up Engine task logic;
- bypass workspace entitlement or RLS boundaries.

Customer-facing delivery belongs to the separate Outbound Follow-Up Email Engine.

## Why quotes are a first-class entity

Quote state should not live directly on `leads` because one lead can receive multiple quotes or revisions. A separate `lead_quotes` row represents one quote version and can optionally supersede an earlier quote.

## Data model

### `lead_quotes`

Workspace-scoped quote records tied to an existing lead.

Core fields:
- `public_id`
- `workspace_id`
- `lead_id`
- `quote_reference`
- `amount`
- `currency_code`
- `status`
- `sent_at`
- `receipt_confirmed_at`
- `expected_decision_at`
- `next_follow_up_at`
- `last_call_outcome`
- `supersedes_quote_id`
- audit timestamps/users

Initial statuses:
- `draft`
- `sent`
- `receipt_confirmed`
- `accepted`
- `declined`
- `expired`
- `superseded`

Initial call outcomes:
- `confirmed_received`
- `has_questions`
- `ready_to_schedule`
- `decision_later`
- `no_answer`
- `pricing_objection`
- `urgent`
- `not_interested`

### `workspace_quote_alert_settings`

One row per workspace. Stores non-secret alert behavior only.

Core fields:
- `enabled`
- `channel`
- `destination_ref`
- `receipt_confirmation_delay_minutes`
- `decision_reminder_lead_minutes`
- `paused_until`

`destination_ref` is a non-secret provider destination identifier such as a Slack channel ID or an internal recipient reference. OAuth tokens, webhook secrets, API keys and provider credentials must live server-side.

### `quote_alerts`

One row per logical internal alert. This is the idempotent alert ledger.

Core fields:
- `public_id`
- `workspace_id`
- `quote_id`
- `lead_id`
- `alert_type`
- `channel`
- `destination_ref`
- `automation_key`
- `status`
- `scheduled_for`
- `attempt_count`
- `last_attempt_at`
- `sent_at`
- `acknowledged_at`
- `provider_message_id`
- `last_error`
- `metadata`

The unique workspace + `automation_key` guard prevents the same logical alert from being created twice.

Initial alert types:
- `receipt_confirmation_due`
- `decision_follow_up_due`
- `decision_overdue`
- `urgent_escalation`

Initial delivery states:
- `pending`
- `sent`
- `failed`
- `acknowledged`
- `cancelled`

Detailed delivery-attempt history can be split into a separate append-only table later if provider retry forensics requires it. In v1, every logical alert remains independently queryable and its major state transitions should also be written to `lead_activities`.

## Reuse existing CRM primitives

### Tasks

Use `lead_tasks` for salesperson work such as:
- Confirm quote receipt
- Call about pricing objection
- Follow up on expected decision date

Suggested automation keys include the quote public ID, for example:

`quote_receipt:qte_xxx`

This keeps quote-generated work visible in the existing Tasks page and allows duplicate guards to stay explicit.

### Activities

Use `lead_activities` for timeline events such as:
- `quote_created`
- `quote_sent`
- `quote_receipt_confirmed`
- `quote_call_outcome`
- `quote_alert_sent`
- `quote_alert_failed`
- `quote_alert_acknowledged`

Quote IDs and structured outcome details should live in `metadata`.

## First workflow

```text
Quote marked sent
  -> log quote_sent activity
  -> schedule receipt-confirmation alert
  -> create/ensure CRM task
  -> wait for alert due time
  -> resolve workspace channel + entitlement
  -> send internal alert through adapter
  -> update quote_alerts ledger
  -> log lead activity
  -> salesperson calls lead
  -> record call outcome
  -> set receipt/decision/next-follow-up state
  -> create next task or escalation if needed
```

## Adapter boundary

The workflow should depend on a small internal alert contract rather than directly wiring business logic to Slack/email.

Example conceptual payload:

```json
{
  "workspace_id": "...",
  "lead_public_id": "ld_...",
  "quote_public_id": "qte_...",
  "alert_type": "receipt_confirmation_due",
  "channel": "slack",
  "destination_ref": "C123456",
  "title": "Quote receipt needs confirmation",
  "message": "A quote was sent and receipt has not been confirmed.",
  "automation_key": "quote-receipt:qte_..."
}
```

Slack or internal email can be the first adapter. Provider credentials remain server-side.

## Entitlement and safety

Before any internal delivery is authorized, verify:
- workspace exists;
- workspace quote alerts are enabled;
- workspace subscription is entitled to the feature;
- workspace is not paused;
- quote and lead belong to the same workspace;
- logical alert has not already succeeded/been acknowledged;
- per-run/per-workspace caps are respected.

No customer-facing message should be emitted from this engine.

## Rollout gates

1. **Schema source review**
   - migration exists only in GitHub;
   - RLS and tenant composite FKs reviewed;
   - no production apply.

2. **Production schema apply**
   - empty tables/settings only;
   - verify RLS;
   - zero existing lead/task/activity changes.

3. **CRM quote lifecycle UI**
   - create/update one synthetic quote;
   - verify timeline events;
   - no internal delivery yet.

4. **Alert dry-run**
   - create one alert ledger row in send-disabled mode;
   - no Slack/email call.

5. **One internal delivery**
   - one QA workspace;
   - one QA quote;
   - one selected adapter;
   - explicit approval;
   - verify one alert + activity only.

6. **Idempotency + retry QA**
   - repeat same logical event;
   - no duplicate successful alert;
   - controlled failure/retry behavior.

7. **Canary activation**
   - enable only a controlled entitled workspace;
   - observe delivery and task counts before broad rollout.

## Not in v1

- customer email/SMS delivery;
- payment links or quote acceptance portals;
- e-signatures;
- quote PDF generation;
- provider-secret management in the browser;
- multi-channel fan-out by default;
- AI-generated pricing or financial advice.
