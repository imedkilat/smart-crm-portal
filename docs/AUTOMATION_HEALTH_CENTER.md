# Automation Health Center v1

## Goal

Give each workspace a read-only operational view of CRM automation health without exposing n8n credentials, provider secrets, idempotency internals, or cross-tenant data.

## v1 data contract

The Health Center combines existing tenant-safe ledgers with a new normalized `automation_runs` execution ledger.

Existing sources:

- `lead_routing_history` for lead-routing acceptance, suppression and webhook failures
- `ai_interactions` for AI Brain completed/failed interactions
- `lead_activities` for Follow-Up Engine task activity
- `outbound_email_deliveries` for logical outbound delivery state and last error
- `outbound_email_attempts` for provider/simulation attempts
- `quote_alerts` for quote-alert delivery state
- `weekly_summary` for the latest weekly reporting heartbeat
- workspace Follow-Up, outbound-email and quote-alert settings for enabled/paused context

New source:

- `automation_runs` for normalized n8n, Edge Function, scheduler and system execution history

## `automation_runs`

The table is intentionally append/update-by-server and read-only to authenticated browser clients.

Required producer fields:

- `workspace_id`
- `automation_key`
- `automation_name`
- `source`: `n8n`, `edge_function`, `scheduler`, `database`, or `system`
- `trigger_type`: `event`, `scheduled`, `manual`, `webhook`, or `retry`
- `status`: `running`, `succeeded`, `failed`, `suppressed`, or `skipped`
- `started_at`

Useful optional fields:

- `run_ref` for an n8n execution ID, Edge request ID, or equivalent provider execution reference
- `correlation_key` for the logical event/idempotency key
- `record_type` and `record_id` for the affected CRM record
- `attempt_number`
- `finished_at` and `duration_ms`
- `error_code` and `error_message`
- `metadata` for non-secret diagnostic context

The unique partial index on `(workspace_id, automation_key, correlation_key, attempt_number)` prevents accidental duplicate run records when a producer has a stable correlation key.

## Security boundary

- RLS is enabled on `automation_runs`.
- Authenticated users only receive rows where `private.is_workspace_member(workspace_id)` is true.
- Authenticated clients receive `SELECT` only.
- `anon` receives no access.
- Writes are reserved for `service_role`/trusted server-side producers.
- `automation_idempotency_keys` and `automation_rate_limit_counters` remain server-internal and are not queried by the UI.
- Run metadata must never contain tokens, credentials, email bodies, auth headers, or other secrets.

## v1 UI

The Automation page becomes the Health Center and remains read-only. It shows:

1. Overall operational state based on recent failed signals.
2. Automation cards for Lead Routing, AI Brain, Follow-Up Engine, Outbound Email, Quote Alerts and Weekly Summary.
3. A normalized-run metric and latest execution heartbeat when producers start writing `automation_runs`.
4. Recent incidents derived from failed normalized runs and existing failure ledgers.
5. Delivery/alert state for outbound email and quote alerts.
6. The existing routing event log for detailed routing diagnostics.

A disabled automation is shown as `Off`, not as failed. Absence of work is not treated as a failure by itself.

## v1 non-goals

- No retry or recovery buttons.
- No direct n8n API calls from the browser.
- No provider credential exposure.
- No automatic assumption that an automation is unhealthy merely because it had no eligible work.
- No ingestion from every producer in the first UI PR. Producer instrumentation can land incrementally after the read model is deployed.

## Follow-Up Engine producer

The first normalized producer is the hourly Follow-Up Engine. Its repo export appends telemetry only after the existing write/shadow summaries, so instrumentation does not change candidate selection, entitlement checks, caps, idempotency, or task creation.

Producer behavior:

- one terminal `automation_runs` row per scoped workspace per n8n execution
- `automation_key = follow-up-engine`
- `source = n8n`
- `trigger_type = scheduled`
- `run_ref` uses the n8n execution ID
- `correlation_key` is `follow-up-engine:<execution-id>:<workspace-id>`
- a workspace with at least one authorized task write is `succeeded` unless any corresponding create result fails, in which case it is `failed`
- a scoped workspace with no authorized task write is `suppressed`, including no-eligible-work, paused/disabled/entitlement, QA allowlist, capacity, or dry-run outcomes
- telemetry inserts use `continueRegularOutput`; observability failure must never block the Follow-Up Engine itself
- telemetry rows contain workspace/run status only. They do not store lead names, emails, message bodies, credentials, auth headers, or provider secrets

The transformer at `scripts/instrument-follow-up-telemetry.mjs` is deterministic and idempotent. It refuses to operate if the repo Follow-Up safety defaults are not `write_enabled=false` and `production_mode=false`, and CI verifies that the generated telemetry nodes write only to `automation_runs`.

The repo export is not evidence that the published n8n workflow has been updated. Production telemetry begins only after the validated export is explicitly synced/published to the live Follow-Up workflow and a controlled run proves the expected row without changing business-write safety settings.

## Follow-Up Health card semantics

The Follow-Up card uses normalized `automation_runs` as its primary heartbeat and keeps `lead_activities` only as a secondary 24-hour business-event metric.

Workspace settings take precedence over execution telemetry:

- workspace paused -> `Off`
- workspace disabled -> `Off`

For an enabled, unpaused workspace, the latest `automation_key = follow-up-engine` row drives the card:

- recent `succeeded` -> `Healthy`
- recent `suppressed` -> `Safe mode`; selection ran but business writes were not authorized
- recent `skipped` -> `Safe mode`; the producer deliberately recorded a no-op
- recent `failed` -> `Needs attention`
- recent `running` -> `Waiting`
- no normalized run -> `Waiting`
- latest run older than 150 minutes -> `Waiting` with a stale-heartbeat message

The 150-minute window intentionally gives an hourly schedule room for normal scheduler/runtime delay while still surfacing a missing heartbeat well before the next business day.

## Scheduled-observability activation gate

Real business writes are not part of the scheduled-observability gate. The first live schedule activation must keep:

- `write_enabled=false`
- `production_mode=true`
- QA allowlists blank
- the hourly workflow published/active only after the exact production version is re-verified

Immediately before activation, record an ISO timestamp as the gate baseline. After the first real hourly execution, run the read-only verifier:

```bash
FOLLOW_UP_EXPECTED_AFTER="<activation-iso-timestamp>" \
FOLLOW_UP_EXPECTED_WORKSPACE_ID="<qa-workspace-id>" \
node scripts/verify-follow-up-scheduled-observability.mjs
```

Optional verifier inputs:

- `FOLLOW_UP_EXPECTED_RUN_REF` pins verification to an exact n8n execution ID when it is already known.
- `FOLLOW_UP_MAX_AGE_MINUTES` changes the default 90-minute freshness limit.

The verifier authenticates as the configured non-admin primary QA identity and requires a fresh Follow-Up row after the activation timestamp with:

- the caller's own workspace only
- `automation_key=follow-up-engine`
- `source=n8n`
- `trigger_type=scheduled`
- `status=suppressed` while writes remain disabled
- populated `run_ref`
- no secret-like metadata/error payloads

This verifier is read-only. Business-table deltas are checked independently against the pre-activation baseline for `lead_tasks`, `lead_activities`, `lead_quotes`, `outbound_email_deliveries`, and `outbound_email_attempts`.

The scheduled-observability gate passes only when the fresh heartbeat is correct, no foreign workspace telemetry appears, and all protected business tables remain unchanged. The workflow may stay scheduled with writes disabled after this gate; enabling writes is a separate explicit approval.

## Emergency rollback

If scheduled observability produces an unexpected business write, foreign-workspace telemetry, malformed run status, repeated unexpected run rows, or any other safety discrepancy:

1. keep or restore `write_enabled=false` immediately
2. unpublish/deactivate the Follow-Up schedule if it is active
3. do not delete or rewrite unexpected CRM rows; preserve them as evidence
4. record the n8n execution ID, workflow version, timestamps and affected workspace/record IDs
5. audit Supabase read-only before deciding on cleanup or another rollout attempt

No cleanup, real-write re-enable, or reactivation should be bundled into the rollback itself.

## Producer rollout order

1. Follow-Up Engine scheduled runs
2. AI Brain Edge/n8n request path
3. Lead intake and status-routing Edge/n8n paths
4. Outbound email dispatch
5. Weekly summary/reporting
6. Quote-alert dispatcher when live execution is introduced

For a run that starts and later finishes, the trusted producer may insert `running` and update it to `succeeded`/`failed`, or insert one terminal row when only final status is available.
