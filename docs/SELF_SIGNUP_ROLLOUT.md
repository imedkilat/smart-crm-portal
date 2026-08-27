# Self-Signup + Automatic Workspace Onboarding Rollout

## Status

Implementation is prepared on `codex/self-signup-workspace-onboarding` and the Vercel preview build passes.

Do **not** expose self-signup in production until the live n8n Lead Intake workflow is workspace-aware. The workflow JSON currently tracked in GitHub is older than the QA-tested live workflow, so it must not be imported over production as-is.

## What this gate adds

- Email/password self-signup in the Smart CRM login screen.
- Workspace name captured as onboarding metadata only, never as an authorization source.
- Authenticated, idempotent `ensure_workspace_onboarding()` RPC.
- Automatic owner membership for the first workspace.
- Automatic default `Sales Pipeline` with seven stages.
- Automatic Free-plan subscription when no subscription exists.
- Direct Data API workspace creation removed so Free users cannot create extra workspaces outside the onboarding gate.
- `crm-lead-intake` and `crm-status-route` authorization changed from global auth metadata to server-side `workspace_members` resolution.
- Status routing rehydrates the authoritative lead from the caller's workspace before sending trusted data to n8n.
- Settings reads the current role from `workspace_members` rather than global auth metadata.

## Production blocker: live n8n Lead Intake workspace propagation

Once a second workspace exists, the legacy single-workspace database trigger intentionally stops guessing which workspace an unscoped lead belongs to. The live Lead Intake workflow must therefore persist the `workspace_id` injected by `crm-lead-intake`.

The GitHub workflow export is stale and should first be replaced with a fresh export of the currently published, QA-tested live workflow before source-control edits are made.

### Required live n8n change

In the currently published Lead Intake workflow:

1. Preserve the trusted workspace context from the Webhook node through normalization.
2. In `Normalize Output`, read `workspace_id` from the original Webhook body rather than from AI output. Do not ask the model to generate or echo tenant identifiers.
3. Add `workspace_id` to every normalized lead item.
4. In `Save to Supabase`, map the `leads.workspace_id` field from the normalized `workspace_id`.
5. Keep all existing secure webhook auth, response behavior, AI classification, and QA-tested nodes unchanged.

Suggested normalization pattern:

```js
const workspaceId = $('Webhook').first().json.body?.workspace_id || null;

// Existing normalization logic...
results.push({
  json: {
    // existing normalized lead fields
    workspace_id: workspaceId,
  },
});
```

Suggested Supabase mapping:

```text
workspace_id = {{ $json.workspace_id }}
```

Before publishing, confirm the incoming Webhook body contains the server-injected workspace value after the new Edge Function is deployed. Never use a browser-supplied lead workspace field as the authorization source.

## Safe rollout order

### Gate 1: n8n live workflow

- Export the currently published Lead Intake workflow and replace the stale GitHub export.
- Add trusted `workspace_id` propagation to `Normalize Output` and `Save to Supabase`.
- Publish the patched workflow.
- With the existing one-workspace production account, verify manual lead intake and Excel intake still save correctly.

This can be done before the second workspace exists. If the old Edge Function is still active during the first n8n edit, keep the workspace mapping nullable so the existing single-workspace fallback continues to work.

### Gate 2: Edge Functions

Deploy the branch versions of:

- `crm-lead-intake`
- `crm-status-route`

Both must keep JWT verification enabled. Confirm existing owner flows still pass after deployment.

Expected behavior after deployment:

- authenticated user with one membership: workspace resolves automatically;
- requested `x-workspace-id` outside the user's memberships: denied;
- lead status request for a lead outside the workspace: denied;
- trusted workspace/user context sent to n8n comes from server-side membership resolution.

### Gate 3: Database migration

Apply:

`20260828013000_self_signup_workspace_onboarding.sql`

Then verify:

- existing workspace count is unchanged;
- existing owner membership is unchanged;
- existing pipeline and seven stages remain unchanged;
- `ensure_workspace_onboarding(text)` is executable by `authenticated` but not `anon`/`public`;
- direct authenticated insert policy on `workspaces` is removed;
- subscription member reads remain workspace-scoped.

Do not create the second workspace manually during this gate.

### Gate 4: Existing-owner regression

Before exposing signup, sign in with the existing owner and verify:

- Dashboard, Leads, Pipeline, Tasks, AI Brain, Insights, Reports, and Settings load.
- Add Lead manual intake saves a lead in the existing workspace.
- Excel intake saves rows in the existing workspace.
- Status routing only acts on a lead in the existing workspace.
- Settings displays the membership role correctly.
- Existing RLS isolation checks still pass.

### Gate 5: Expose self-signup

Only after Gates 1-4 pass, merge the frontend/onboarding branch to `main`.

Then perform one controlled test signup using a new email address and a disposable workspace name.

Expected onboarding result:

- one new Auth user;
- one new workspace;
- one owner membership for that user;
- one default Sales Pipeline;
- seven default stages;
- one active Free subscription;
- no access to the original workspace's records.

### Gate 6: Tenant-isolation E2E

From the new account:

- create one manual lead and verify its `workspace_id` is the new workspace;
- confirm the original owner cannot see the new lead;
- confirm the new owner cannot see the original workspace's leads;
- attempt status routing against an original-workspace lead ID and expect denial;
- use AI Copilot and confirm workspace resolution remains scoped;
- retry onboarding and confirm no duplicate workspace, pipeline, stages, membership, or subscription are created.

## Rollback notes

Before Gate 5, frontend production is unchanged, so rollback is limited to backend changes.

If the n8n workspace patch fails, restore the immediately prior published workflow version before creating any second workspace.

If the Edge Function deployment regresses the existing owner, redeploy the previously active source/version before proceeding.

If the onboarding migration needs correction, do not expose signup. Ship a forward-only corrective migration rather than editing an already-applied migration file.

## Commercial follow-ups after self-signup

This gate creates a usable Free-plan onboarding path. It does not yet complete paid checkout, invitations, workspace switching, usage enforcement, custom SMTP, subscription lifecycle webhooks, or admin billing controls. Those remain later commercialization gates.
