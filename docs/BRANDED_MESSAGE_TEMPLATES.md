# Branded Message Template System

Status: **source-only draft** until the separate production rollout gate is explicitly approved.

This track adds the reusable message-template layer that sits between Workspace Branding and any future outbound email provider. It intentionally does **not** send email.

## Product boundary

The template system owns:

- workspace-scoped email template records
- owner/admin editing and member read access
- deterministic plain-text variables
- validation for unknown or malformed variables
- live preview using sample lead data
- inheritance from `workspace_branding`
- monotonic template revision numbers
- default-template selection per purpose
- safe enable/disable controls

It does not own:

- SMTP/provider credentials
- sending or scheduling
- unsubscribe links
- bounce/delivery/open tracking
- sender-domain verification
- n8n outbound-email workflow activation
- billing/entitlement checks for actual sending

Those stay in the later **Outbound Follow-Up Email Engine** gate.

## Schema

`public.message_templates`

Important fields:

- `workspace_id`
- `template_key`
- `name`
- `channel` (`email` only in this slice)
- `purpose`: `follow_up`, `re_engagement`, `custom`
- `subject_template`
- `body_template`
- `tone`: `professional`, `friendly`, `warm`, `concise`
- `is_enabled`
- `is_default`
- `version`
- audit fields

Each workspace gets two starter templates:

1. `hot-follow-up`
2. `warm-re-engagement`

New workspaces receive the same defaults through a private provisioning trigger.

Only one default email template may exist per `(workspace, purpose)`.

## Access model

RLS follows the existing Smart CRM workspace model:

- workspace members: `SELECT`
- workspace owners/admins: `INSERT`, editable-column `UPDATE`, and `DELETE`
- `anon`: no access
- `service_role`: full access

Authenticated users cannot update tenant identity (`workspace_id`), revision counters, or audit columns directly.

The Settings UI also fails closed when an account belongs to multiple workspaces until Smart CRM has an explicit active-workspace selector.

## Allowed variables

The first version supports only:

### Lead

- `{{lead.first_name}}`
- `{{lead.name}}`
- `{{lead.company}}`
- `{{lead.email}}`
- `{{lead.routing_status}}`

### Workspace

- `{{workspace.company_name}}`
- `{{workspace.website_url}}`
- `{{workspace.sender_name}}`
- `{{workspace.reply_to_email}}`
- `{{workspace.email_signature}}`

Unknown variables or malformed `{{...}}` tokens block saving in the UI.

## Rendering and escaping

Templates are **plain text**, not user-authored HTML.

`src/lib/messageTemplates.ts` provides:

- variable extraction
- strict allowlist validation
- deterministic text rendering
- HTML escaping for future provider wrappers
- newline-to-`<br />` conversion only after escaping

The current Settings preview renders React text nodes and never uses `dangerouslySetInnerHTML`.

A future outbound-email layer should render the plain-text template first, then place escaped output inside a controlled branded HTML shell. User template content must not become arbitrary executable HTML.

## Revision semantics

Every update to a template row increments `version` and updates `updated_at` / `updated_by` through a database trigger.

The current source does not create a historical snapshot table. `version` is a monotonic revision marker only. Full template history can be added later if commercial requirements justify it.

## Default switching

The database has a partial unique index allowing one default email template per workspace/purpose.

When an owner/admin marks a different template as default, the Settings UI first clears the previous default for that purpose, then saves the selected template.

This is sufficient for the editing surface. The future outbound engine should still fail closed if no enabled default exists.

## Rollout plan

Do not apply the migration merely because the source PR is merged.

Production rollout should separately verify:

1. migration history
2. starter-template backfill for every workspace
3. owner/admin create/update/default switching
4. normal-member read-only behavior
5. cross-workspace isolation
6. unknown/malformed variable rejection in the UI
7. preview inheritance from live Workspace Branding
8. revision increment on save
9. no outbound provider/network calls from the template component
10. Supabase security/performance advisors after DDL

## Future handoff to outbound email

The later Outbound Follow-Up Email Engine should consume:

- the workspace's enabled/default template
- the workspace branding profile
- a lead record scoped to the same workspace
- verified sender/provider configuration
- entitlement + automation caps
- unsubscribe/compliance state

The renderer should remain shared so preview and production delivery cannot silently interpret variables differently.
