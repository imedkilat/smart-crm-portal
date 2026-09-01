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

## Producer rollout order

1. Follow-Up Engine scheduled runs
2. AI Brain Edge/n8n request path
3. Lead intake and status-routing Edge/n8n paths
4. Outbound email dispatch
5. Weekly summary/reporting
6. Quote-alert dispatcher when live execution is introduced

For a run that starts and later finishes, the trusted producer may insert `running` and update it to `succeeded`/`failed`, or insert one terminal row when only final status is available.
