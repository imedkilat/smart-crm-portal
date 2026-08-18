# Smart CRM Commercial Architecture

This document is the engineering bar for turning Smart CRM into a commercial SaaS product rather than a portfolio demo.

## Product principle

Smart CRM is an AI sales-operations workspace for founder-led and small businesses. It should answer four daily questions:

1. Who needs attention now?
2. What stage is every opportunity in?
3. What should happen next?
4. What can safely be automated without losing control?

The product must keep AI classification separate from business truth. AI can recommend, classify, summarize, and draft. Durable CRM state such as sales stage, task completion, ownership, billing state, and permissions must be explicit application data with auditability.

## Current commercial foundation

- Authenticated Supabase application
- Private n8n ingress behind Supabase Edge Functions
- Non-sequential public IDs for customer-facing records
- Workspace and membership foundation
- URL-driven navigation and deep-linked leads
- USD-standard lead intake
- AI lead quality: Hot / Warm / Cold
- Sales pipeline: New / Contacted / Qualified / Proposal / Negotiation / Won / Lost
- Drag-and-drop Kanban with non-drag fallback
- Internal lead notes
- Follow-up tasks with due date, priority, and completion state
- Server-side activity events for pipeline moves, notes, and tasks
- AI routing audit history
- Application-level rate limiting and duplicate-request protection on automation gateways

## Reliability bar

Every commercial feature should meet these requirements before it is considered complete.

### Authorization

- Every business record belongs to a workspace.
- Access is enforced with RLS or a trusted server boundary, not only hidden in the UI.
- Client-supplied workspace IDs are never trusted for authorization.
- Service-role credentials never enter browser code.
- Role checks distinguish owner/admin/member/viewer capabilities where the feature needs them.

### Input guardrails

- Validate method, content type, payload size, required fields, enum values, and string lengths at the trusted boundary.
- Reject malformed or unexpected input with useful 4xx responses.
- Do not let AI decide immutable identifiers, permissions, currency, ownership, billing state, or authoritative pipeline state.

### Abuse protection

- Expensive or externally connected actions have per-user and eventually per-workspace rate limits.
- Automated writes use idempotency keys where duplicate execution can cause damage or cost.
- UI buttons disable during in-flight mutations, but server protections remain authoritative.
- External webhook endpoints use independent authentication, replay protection, and request-size limits.

### Durable automation

The long-term automation model should be event/outbox based:

`CRM mutation -> durable event -> worker/n8n -> execution record -> retry/backoff -> success or dead letter`

User-facing database writes should not depend indefinitely on a third-party automation request succeeding synchronously. Every automation event should have an event ID, workspace ID, type, payload version, state, attempt count, timestamps, and last error.

### Observability

For important workflows track:

- request count
- success/error rate
- automation latency
- retry count
- rate-limit hits
- dead-letter count
- stale task count
- stuck pipeline opportunities

Production errors should be queryable without reproducing them from the UI.

### Auditability

Important changes must be reconstructable. Examples:

- stage changes
- task create/complete/reopen
- notes
- ownership changes
- automation triggered/suppressed/failed
- workspace membership and permission changes
- billing/plan changes

Audit entries should be append-oriented and include actor, workspace, record, timestamp, action, and relevant before/after metadata.

### Failure behavior

- Fail closed on authorization and protection-layer failures.
- Prefer rollback or retryable state over partially pretending an automation succeeded.
- External failures should produce actionable status, not silent data loss.
- Destructive actions need confirmation and, where practical, archive/restore instead of immediate hard delete.

## Multi-tenant target architecture

Current workspace support is a foundation, not yet the final tenant boundary. Before onboarding unrelated paying businesses:

- replace global owner-style lead authorization with workspace-scoped RLS
- workspace-scope routing history, summaries, insights, automation events, and future objects
- authorize Edge Functions from workspace membership rather than a global owner role
- resolve workspace context server-side from authenticated membership
- pass only trusted workspace context into n8n and server writes
- add workspace switcher and invitation/member management
- add tenant-isolation tests that prove Workspace A cannot read or mutate Workspace B

## Sales data model direction

AI lead quality and sales progress are deliberately separate:

- `category / routing_status`: AI or routing signal (Hot, Warm, Cold)
- `pipeline_stage_id`: authoritative business stage

Future CRM entities:

- contacts and companies
- opportunities/deals if one contact can have multiple sales motions
- tags and custom fields
- activities and communication events
- tasks/reminders
- owners/assignees
- automation rules
- integrations/connections
- usage events and subscription entitlements

## Next product layers

### Operations

- global Tasks / Today inbox
- overdue and upcoming follow-up queues
- lead ownership and assignment
- tags and saved views
- custom fields
- company/contact model
- duplicate detection and merge

### Automation

- stage-change rules
- task-triggered reminders
- stale-lead detection
- webhook/API intake
- durable automation outbox
- retries, backoff, dead-letter queue
- execution log with correlation IDs

### AI

- next-best-action recommendations
- deal-risk and stale-opportunity detection
- follow-up drafts with human approval
- explainable lead scoring
- weekly executive pipeline brief
- natural-language CRM search grounded in workspace data

### Commercial SaaS

- team invitations and granular roles
- onboarding wizard and pipeline templates
- subscription plans and usage metering
- plan limits enforced server-side
- billing lifecycle and entitlements
- audit/export/delete controls
- branded reports
- integration marketplace direction

## Rate-limit evolution

The current Postgres-backed fixed-window limiter is a first commercial protection layer and intentionally fail-closed. It is suitable for current traffic and keeps the system dependency-light.

At higher concurrency, move burst protection to a distributed low-latency store such as Redis while retaining durable usage metering in Postgres. Protective burst limits and billable plan quotas are different concerns and should remain separate.

## Definition of done for a commercial feature

A feature is not done because the screen renders. It is done when:

- the happy path works
- direct URL/refresh behavior works where applicable
- authorization is enforced server-side
- invalid input is rejected
- duplicate/repeated actions are safe
- loading/error/empty states exist
- important mutations are auditable
- external failures are visible and retryable where appropriate
- data is workspace-scoped
- the production build passes
- the behavior is verified against production-like data
