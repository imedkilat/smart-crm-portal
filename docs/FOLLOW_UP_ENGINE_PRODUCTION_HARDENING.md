# Follow-Up Engine Production Hardening

Status: **Source-only draft. Do not apply the migration, publish the workflow, or activate the hourly schedule yet.**

This layer builds on the controlled QA already completed for the safe MVP. The earlier gate proved that dry-run mode authorized zero writes, one exact allowlisted QA lead created one internal task, the server-side `task_created` activity was recorded, and the immediate rerun created no duplicate. Production activation is still a separate gate.

## Why this hardening exists

The controlled-QA workflow was intentionally conservative, but it was not yet suitable for a commercial multi-tenant scheduler. The production-hardened draft addresses these remaining risks:

- one global timezone instead of workspace-local behavior
- no workspace-level enable/disable or pause control
- no Starter+ entitlement gate despite Follow-up automation being a paid-plan feature
- all-tenant CRM reads under a service-role credential
- QA-only one-write limiting rather than bounded per-workspace production capacity
- read-before-write idempotency that could race under overlapping executions
- no database constraint tying `lead_tasks.workspace_id` to the referenced lead's workspace
- no database-level re-check of production entitlement or daily caps at insert time
- no database-level guard against two overlapping executions creating different open automation keys for the same lead
- over-broad authenticated table privileges on `lead_tasks` compared with what the frontend actually needs

## Source files

- Workflow: `n8n/workflows/crm-follow-up-engine-mvp.json`
- Migration: `supabase/migrations/20260829001000_follow_up_engine_production_hardening.sql`
- This runbook: `docs/FOLLOW_UP_ENGINE_PRODUCTION_HARDENING.md`

The legacy `n8n/workflows/crm-follow-up-engine.json` Sheets/Gmail/calendar workflow is out of scope and must remain inactive.

## Default safety posture

The hardened workflow remains exported with `active=false`.

`Safety Configuration` defaults:

- `write_enabled=false`
- `production_mode=false`
- `qa_workspace_id=""`
- `qa_lead_public_id=""`
- `global_max_writes_per_run=5`

These are separate controls. Production evaluation requires `production_mode=true`; production mutation additionally requires `write_enabled=true`. Exact QA mode is available only while production mode is false and both QA allowlist fields are populated.

## Per-workspace settings

The migration adds `public.workspace_follow_up_settings`, one row per workspace:

- `enabled` — default `false`
- `timezone` — default `UTC`
- `hot_stale_hours` — default `2`
- `warm_stale_hours` — default `24`
- `max_tasks_per_run` — default `1`
- `max_tasks_per_day` — default `10`
- `paused_until` — optional emergency pause
- timestamps

Existing workspaces are backfilled with disabled rows. A workspace insert trigger creates a disabled row for new workspaces.

### Settings access

RLS remains enabled. Workspace members can read their settings row. Workspace members with role `owner` or `admin` can update it through the authenticated Data API. Anonymous access is revoked. Authenticated UPDATE is column-limited to the actual user-configurable fields; clients cannot create/delete settings rows or edit system columns. The service role retains internal access.

## Plan entitlement

Production follow-up is authorized only when all of these are true:

- a settings row exists
- `enabled=true`
- the configured IANA timezone is valid
- `paused_until` is empty or in the past
- subscription status is `trialing` or `active`
- plan code is `starter`, `pro`, or `white_label`

Free workspaces, missing subscriptions, inactive plans, disabled workspaces, paused workspaces, and invalid timezones fail closed.

The workflow performs this check while building tenant scope. The database insert guard repeats the critical production entitlement checks so a service-role caller cannot bypass them accidentally by skipping the n8n pre-filter.

## Tenant-scoped reads

`Build Eligible Workspace Scope` calculates the workspaces that may be evaluated. The CRM-owned read nodes then filter to only those workspace IDs:

- active Hot/Warm leads
- lead activities
- lead tasks
- pipeline stages

If no workspace qualifies, the generated filter points to an impossible all-zero UUID, producing an empty CRM scope instead of falling back to an all-tenant scan.

## Candidate rules

Within each scoped workspace, the workflow:

1. skips Won/Lost stages
2. skips leads that already have an open task
3. finds last touch from latest lead activity, then `status_changed_at`, then `created_at`
4. applies the workspace Hot/Warm stale threshold
5. calculates the workspace-local calendar day
6. builds a deterministic machine key and legacy description marker
7. skips an existing same-day duplicate
8. calculates priority and due time
9. applies the workspace daily capacity
10. sorts Hot before Warm and then most stale first
11. takes no more than `max_tasks_per_run` for that workspace

## Production and QA automation keys

Production key:

`follow-up:v1:<lead_public_id>:<workspace-local-day>:<routing_status>`

Controlled QA key:

`follow-up:qa:v1:<lead_public_id>:<workspace-local-day>:<routing_status>`

The separate QA namespace matters: database production daily-count enforcement only counts production keys, and production mode disables the QA bypass entirely. The current workflow still retains the legacy description marker for compatibility with the earlier controlled-QA generation; the machine key is the authoritative concurrency/idempotency boundary after this migration.

## Fair scheduling and global cap

Each workspace first receives its own bounded candidate queue. The workflow then interleaves one candidate per workspace in round-robin order rather than allowing the largest tenant to fill the global run cap first.

The starting workspace rotates by UTC hour. This avoids a fixed first-workspace advantage across repeated hourly runs. Only after this fairness step does `global_max_writes_per_run` limit write authorization.

The workflow summary exposes the rotation offset, workspace stats, scoped-workspace diagnostics, selected candidate count, and authorized write count.

## Atomic idempotency and tenant integrity

The migration adds nullable `lead_tasks.automation_key` and a unique partial index on `(workspace_id, automation_key)` when the key is non-null. Human tasks keep `automation_key=NULL`.

A second partial unique index allows at most one **open automated Follow-Up Engine task per workspace + lead**, regardless of day/status key. This closes the overlap edge where two executions could race with different keys for the same lead.

Authenticated `lead_tasks` privileges are reset to explicit least privilege: normal clients retain `SELECT`, `DELETE`, and column-limited human `INSERT`/`UPDATE`; `automation_key`, `TRUNCATE`, `TRIGGER`, and other machine/admin-only capabilities are not granted. The service role retains internal access.

The migration also adds a composite foreign key:

`lead_tasks(workspace_id, lead_id) -> leads(workspace_id, id)`

This prevents a task from referencing a lead in another tenant even if a caller supplies individually valid IDs. Production was checked before drafting this migration and had zero existing task/lead workspace mismatches and zero duplicate open legacy auto-follow-up tasks.

## Transactional production insert guard

`private.guard_follow_up_task_insert()` runs before machine-created task inserts.

For normal human tasks (`automation_key IS NULL`) it returns immediately.

For machine keys it:

- accepts only the production and controlled-QA prefixes above
- acquires a transaction-scoped PostgreSQL advisory lock for the workspace
- lets exact QA keys proceed without a paid-plan requirement
- for production keys, rechecks workspace settings, pause state, Starter+ entitlement, and workspace-local daily count
- rejects an insert once `max_tasks_per_day` is reached

The advisory transaction lock serializes automated inserts for the same workspace. Combined with the unique automation key and one-open-auto-task-per-lead constraint, overlapping scheduler executions fail closed instead of creating duplicate or conflicting follow-up tasks.

## Shadow-mode gate

Before any production write test, use:

- `production_mode=true`
- `write_enabled=false`
- both QA allowlist fields blank

Run manually while the workflow remains inactive/unpublished.

Expected:

- only eligible enabled Starter+/trialing workspaces are scoped
- Free, disabled, paused, missing-subscription, and invalid-timezone workspaces are excluded
- candidates may be evaluated and selected
- `write_authorized_count=0`
- `Create Internal Follow-up Task` does not execute
- `lead_tasks` does not change

Review `scope_diagnostics`, `workspace_stats`, `run_selected_count`, `fair_rotation_offset`, and candidate metadata before any write gate.

## Controlled production-mode write gate

Requires separate explicit approval after the migration is applied and shadow mode passes.

Use one dedicated eligible Starter+ workspace and conservative settings. Keep the workflow inactive and execute manually only. Confirm the global write cap and workspace run/day caps before temporarily enabling writes.

After the manual run verify:

- only the expected tenant received a task
- task workspace and lead workspace match
- production `automation_key` is present
- task priority/due date are correct
- server-side `task_created` activity exists
- total daily production count is within the workspace cap
- an immediate rerun creates no duplicate

Restore `write_enabled=false` immediately afterward.

## Migration rollout checklist

Do not treat merging source as permission to change production. Migration/runtime rollout is a later gate:

1. review and merge the source PR
2. apply the migration through the normal Supabase migration workflow
3. run Supabase security and performance advisors
4. verify one disabled settings row per workspace
5. verify owner/admin settings updates and ordinary-member read-only behavior
6. confirm existing human task create/update/delete UI paths still work
7. confirm authenticated clients cannot set `automation_key` and no longer hold unnecessary task-table admin privileges
8. confirm the composite tenant FK is validated
9. confirm the one-open-automated-task-per-lead index is present
10. import/update the hardened n8n workflow
11. reconnect the existing Smart CRM Supabase credential on every Supabase node
12. keep the workflow inactive/unpublished
13. run shadow mode
14. only after another approval, run a bounded production-mode write test
15. restore writes OFF
16. publish/activate the hourly schedule only under a separate explicit activation approval

## Non-goals

This engine creates **internal CRM follow-up tasks only**. It does not send email, SMS, calendar events, or other external messages. External follow-up channels require a separate product and safety design.
