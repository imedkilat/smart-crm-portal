# Smart CRM Commercial Product Roadmap

## Product thesis

Smart CRM is an AI-assisted operating system for small businesses that need to capture, prioritize, follow up with, and learn from leads without maintaining a traditional sales operations team.

The product should not be positioned as a generic contact database. Its differentiator is a connected operating loop:

1. Capture leads from manual entry, spreadsheet imports, forms, and integrations.
2. Classify intent and urgency with AI while preserving source data.
3. Route leads into an operational sales pipeline.
4. Create and automate follow-up work.
5. Keep human notes, tasks, and activity history attached to the lead.
6. Measure conversion, response, source quality, and pipeline value.
7. Generate actionable AI summaries and recommendations.

## Ideal customer profiles

Initial commercial focus:

- service businesses
- agencies and consultants
- home services
- real estate teams
- clinics and appointment-based businesses
- local B2B companies
- founder-led businesses without a dedicated RevOps team

Avoid becoming a horizontal enterprise CRM too early. The first version should win by being faster to configure and more automated than traditional CRMs.

## Commercial architecture principles

### Multi-tenant by design

Every business belongs to a workspace. Workspace membership, roles, and row-level security must be the actual authorization boundary.

### Public IDs are not database IDs

Customer-facing URLs use stable non-sequential public identifiers such as `ld_...`, `tsk_...`, and later `rep_...` or `auto_...`.

### AI never owns source-of-truth fields

AI may classify, summarize, recommend, draft, and score. It must not silently rewrite business-critical source fields such as budget, email, source, or workspace ownership.

### Automation is observable

Every automation should eventually expose status, last run, failure reason, retry state, and the business record that triggered it.

### Human work and automation share one timeline

Notes, tasks, routing events, messages, stage changes, and automation outcomes should converge into a single lead activity timeline.

## Product modules

### 1. Workspace and account

Current foundation:

- workspace records
- workspace memberships
- owner role
- RLS foundation

Next:

- workspace switcher
- business profile
- timezone
- default currency (USD in current product)
- logo and brand settings
- invite members
- owner/admin/member roles
- onboarding checklist

### 2. Lead CRM

Current:

- manual lead intake
- Excel import
- AI category / intent / summary
- routing status
- public lead IDs
- deep-link lead profiles
- archive / restore
- global search
- lead notes
- follow-up tasks

Next:

- tags
- custom fields
- deduplication
- merge leads
- contact company field
- phone field
- acquisition metadata
- lead owner / assignee
- import mapping preview
- bulk actions

### 3. Sales pipeline

Separate AI classification from business pipeline stages.

Suggested default pipeline:

1. New
2. Contacted
3. Qualified
4. Proposal
5. Negotiation
6. Won
7. Lost

Features:

- customizable stages
- kanban view
- drag-and-drop stage changes
- stage conversion rates
- time-in-stage metrics
- won/lost reasons
- stage automations

### 4. Follow-up and productivity

Current:

- lead tasks
- due date
- priority
- completion state

Next:

- workspace task inbox
- overdue dashboard
- reminders
- recurring tasks
- task assignment
- task templates
- SLA timers
- daily agenda

### 5. Lead activity timeline

Unify:

- lead created
- AI classified
- note added
- task created/completed
- routing status changed
- pipeline stage changed
- email/SMS sent
- email reply received
- automation started/completed/failed
- report included

The timeline should become the forensic source of truth for every lead.

### 6. Automation engine

Current:

- secure Supabase Edge Function ingress
- n8n lead classification
- status routing
- duplicate automation guard

Commercial target:

- automation definitions stored per workspace
- trigger + conditions + actions model
- enable/disable per rule
- run log
- retry failed run
- test mode
- templates
- webhook/API integrations
- Gmail/Outlook
- SMS provider
- Slack
- Google Sheets
- Calendars
- Zapier/n8n-compatible outbound webhooks

Example rules:

- When Hot lead arrives → create high-priority task + email owner immediately.
- When lead stays New for 2 hours → remind assignee.
- When Proposal stage has no activity for 3 days → create follow-up task.
- When lead becomes Won → stop nurturing automations.

### 7. AI layer

Current:

- lead category
- intent
- summary
- weekly commentary

Next:

- confidence score
- explainable lead score
- next-best-action recommendation
- follow-up draft
- call preparation brief
- objection extraction
- duplicate detection assistance
- pipeline risk detection
- weekly founder briefing
- conversational CRM query

Example questions:

- Which leads need attention today?
- Why did Hot lead volume drop this week?
- Which source produces the highest-value qualified leads?
- What deals are likely to stall?

### 8. Analytics

Current:

- lead distribution
- source mix
- intent mix
- budget signals
- arrival trend
- AI weekly summary

Commercial target:

- lead → qualified conversion
- qualified → won conversion
- source conversion
- pipeline velocity
- average response time
- time to first touch
- task completion SLA
- revenue won
- expected pipeline
- stage aging
- salesperson performance
- automation-assisted conversions
- date-range comparison

### 9. Reporting

Next:

- saved report definitions
- scheduled weekly/monthly reports
- branded PDF reports
- email recipients
- workspace logo
- report public IDs
- report archive
- report generation history

### 10. Team and permissions

Roles:

- owner
- admin
- manager
- member
- viewer

Eventually support permissions for:

- leads
- exports
- automations
- reports
- settings
- billing
- member management

### 11. Integrations

Priority order:

1. web forms / webhook
2. Gmail or Outlook
3. Google Calendar
4. SMS
5. Slack
6. Zapier / n8n outbound webhook
7. Stripe
8. Facebook / Meta leads
9. website chat

### 12. Billing and packaging

Potential packaging:

#### Starter

- 1 workspace
- 1-2 users
- lead CRM
- manual + spreadsheet intake
- basic AI classification
- notes/tasks
- basic analytics

#### Growth

- more users
- automation rules
- integrations
- scheduled reports
- richer analytics
- AI recommendations

#### Pro

- advanced automations
- team permissions
- higher usage
- white-label reports
- API/webhooks
- priority support

Billing should be implemented only after workspace isolation, usage tracking, and entitlement checks are reliable.

## Build sequence

### Commercial Foundation — in progress

- [x] Secure authenticated automation ingress
- [x] Stable public lead IDs
- [x] URL-driven page navigation
- [x] Deep-link lead profile URLs
- [x] Browser back/forward routing
- [x] Deep-link preservation through login
- [x] Workspace schema foundation
- [x] Workspace membership foundation
- [x] USD standard for current product
- [x] Lead notes schema
- [x] Follow-up tasks schema
- [x] Notes/tasks in lead profile

### CRM Operations

- [ ] Pipeline stages
- [ ] Kanban pipeline view
- [ ] Tags
- [ ] lead owner / assignee
- [ ] unified activity timeline
- [ ] workspace task inbox
- [ ] overdue/task KPIs

### Automation Platform

- [ ] workspace automation rules
- [ ] rule builder
- [ ] automation execution records
- [ ] retries
- [ ] templates
- [ ] email/SMS actions

### Team SaaS

- [ ] member invitations
- [ ] workspace switcher
- [ ] expanded roles
- [ ] tenant-aware Edge Function ingress
- [ ] enforce workspace RLS on leads and all operational records
- [ ] audit log

### Commercialization

- [ ] onboarding
- [ ] usage metering
- [ ] plan entitlements
- [ ] Stripe subscriptions
- [ ] custom domain / brand options
- [ ] legal/privacy pages
- [ ] support/admin tooling

## Current product boundary

The current build is moving from a single-owner automation CRM into a commercial multi-tenant architecture. Workspace tables and memberships exist, but lead authorization still uses the original owner policy. Do not market the product as fully multi-tenant until tenant-aware ingress and workspace-based lead RLS are completed and tested.

That security boundary is a release blocker for onboarding external paying customers.
