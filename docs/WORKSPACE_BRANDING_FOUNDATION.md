# Workspace Branding & Client Identity

Status: **Source-only foundation. Do not treat merge as production rollout approval.**

This track makes client identity a reusable workspace-level capability instead of hard-coding branding inside each future email or chatbot workflow.

## Product scope

The foundation stores one brand profile per workspace:

- company name
- public company logo path
- primary and secondary colors
- website URL
- default sender display name
- default reply-to email
- reusable email signature

This does **not** send email, verify sender domains, or white-label the full Smart CRM shell. Those belong to later outbound-email and white-label gates.

## Database model

`public.workspace_branding` is one-to-one with `public.workspaces`.

Existing workspaces are backfilled from `workspaces.name`. New workspaces receive a default row from an `AFTER INSERT` trigger.

RLS model:

- workspace members can read
- only workspace owners/admins can update
- authenticated clients cannot insert/delete brand rows directly
- the system trigger owns row creation
- `service_role` retains internal access

## Logo storage model

Logos are intentionally **public brand assets**, not private customer data.

Use a public Supabase Storage bucket named `workspace-brand-assets`.

Create the bucket through Supabase Studio or the supported Storage API. Do not insert rows directly into `storage.buckets`.

Recommended bucket configuration:

- public: `true`
- file size limit: `2 MiB`
- allowed MIME types: `image/png`, `image/jpeg`, `image/webp`

Object layout is fixed to `<workspace_uuid>/logo.<png|jpg|jpeg|webp>`.

Storage RLS in the migration permits workspace members authenticated metadata/list access inside their own workspace folder and permits only workspace owners/admins to upload, replace, or delete the workspace logo. Cross-workspace writes fail closed.

The public bucket means anyone with the final logo URL can retrieve the logo. That is deliberate for future email rendering and public chatbot/widget surfaces.

## Settings UI

`WorkspaceBrandingPanel` is added to Settings and includes logo upload/replace/remove, company identity fields, brand colors, sender/reply-to identity, a signature editor, and a live email-style preview.

The UI is read-only for non-admin members. It also handles a source-preview-before-migration state gracefully, and a missing logo bucket does not block saving text/color branding.

The UI never sends an email.

## Rollout gate

Source review/merge and production rollout stay separate.

Recommended rollout order:

1. review source PR
2. merge only after explicit approval
3. apply the branding database migration
4. run Supabase security/performance advisors
5. verify one `workspace_branding` row per workspace
6. verify member read vs owner/admin update RLS
7. create `workspace-brand-assets` through Studio / Storage API with the restrictions above
8. test owner/admin upload + replace + delete
9. test a normal member cannot mutate branding
10. verify cross-workspace logo writes fail
11. verify Settings remains healthy and preview resolves the public logo URL

## Next product layers

Once this foundation is proven, the same brand profile can feed branded message templates, outbound follow-up email rendering, chatbot appearance/business identity, and future white-label portal controls.

The brand profile should remain the single source of truth rather than duplicating company identity inside each automation.
