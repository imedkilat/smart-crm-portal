# Smart CRM E2E regression strategy

## Goal

Catch regressions in the highest-risk product paths without turning the test suite into an uncontrolled production writer.

## Safety rules

- Pull-request CI runs non-destructive checks only.
- Never store test credentials in the repository.
- Never create, update, or delete production leads, quotes, tasks, subscriptions, memberships, or outbound deliveries from the default PR suite.
- Mutation tests must use dedicated synthetic QA fixtures, explicit idempotency keys, bounded write counts, and post-test verification.
- Cross-tenant tests must prove denied access without granting temporary memberships or weakening RLS.
- Controlled automation checks must refuse to run without an explicit QA-only confirmation phrase.
- A manual regression workflow is not permission to enable live provider sending or quote-alert delivery.

## Phase 1: foundation — merged

Automated now:

1. Protected routes redirect unauthenticated users to `/login`.
2. Sign-in required-field validation remains intact.
3. Workspace signup keeps full-name, workspace-name, email, password, and confirmation requirements.
4. Password recovery entry remains reachable.
5. A configured QA account can sign in and read `/dashboard`, `/quotes`, and `/ai-brain` without writes.
6. GitHub Actions runs Chromium regression CI and retains the Playwright report artifact.

## Phase 2: tenant isolation — merged

Phase 2 landed in production at squash SHA `0f81657a144d6846c2c0e8ba080653c12a458b92`.

Two existing non-platform-admin QA identities authenticate independently and each resolve exactly one workspace. The automated contract proves:

- the two workspace IDs are different;
- each account can read its own workspace row;
- workspace A cannot read workspace B, and workspace B cannot read workspace A;
- direct authenticated Supabase queries return an empty result for the foreign workspace across:
  - `workspace_members`
  - `leads`
  - `lead_quotes`
  - `lead_tasks`
  - `lead_activities`
  - `workspace_branding`
  - `workspace_follow_up_settings`
  - `workspace_outbound_email_settings`
  - `workspace_quote_alert_settings`

All of these tables have authenticated SELECT access with RLS enabled, so a foreign-tenant read must be filtered to `[]` without weakening privileges or adding temporary memberships.

No membership or CRM-data mutation occurs inside the tenant-isolation test.

## Phase 3: controlled automation regression

### Read-only production preflight — merged and passed

The manual `Controlled E2E regression` workflow is merged at squash SHA `a23ce91cf79a9d09fe734b8a3a2650edf53c6441` and passed on `main` in workflow run `33430290598` with confirmation:

`SMART_CRM_SYNTHETIC_QA_ONLY`

The preflight proves the known Starter QA Follow-Up task, quote lifecycle fixture, outbound simulation fixture, disabled outbound state, and disabled quote-alert state without any insert/update/delete/provider call. Independent database verification after the run remained exactly one Follow-Up task, three lead activities, one controlled quote, one outbound delivery, and one outbound attempt.

### Outbound duplicate/idempotency replay — merged and passed

The controlled outbound gate is merged at squash SHA `5d83772d3336e1665c20b4f6292fb50eb409e5ba` and passed on workflow run `33431605877`, attempt 2, with confirmation:

`SMART_CRM_OUTBOUND_DUPLICATE_QA`

The real `crm-outbound-email` Edge Function returned the existing logical delivery with `duplicate = true`. Independent production verification remained exactly one delivery and one attempt, with no provider message ID and `network_call_performed = false`. Outbound settings remained disabled and provider unset.

Why quote mutation is not part of the repeatable production suite:

- authenticated members have INSERT/SELECT/UPDATE access to `lead_quotes`, but no DELETE policy;
- `lead_activities` also has no DELETE policy;
- therefore a repeatable quote create/update test would permanently accumulate QA rows unless the regression bypassed normal RLS with privileged cleanup, which is intentionally not allowed.

Likewise, fresh Follow-Up writes remain deferred until a deterministic product-level reset/cleanup strategy exists. The regression program records those as deliberate exclusions rather than weakening production controls for test convenience.

## Phase 4: AI scoped-context boundary

A successful AI Brain request persists an `ai_interactions` row and can create candidate `ai_memories`. Because those records are intentionally not disposable in the production QA tenant, Phase 4 does not make a normal model call on every regression run.

Instead, the manual `Controlled AI scope boundary` gate exercises the real `crm-ai-copilot` Edge Function and proves the authorization boundary before the n8n/model persistence path:

- two non-platform-admin QA identities authenticate independently;
- each resolves exactly one distinct workspace and one active lead fixture;
- direct RLS reads cannot see the foreign lead;
- using identity A with identity B's `x-workspace-id` returns HTTP 403 `Workspace access denied`;
- using identity A's valid workspace with identity B's lead `public_id` as `scope_type = lead` returns HTTP 403 `Requested AI scope is not available in this workspace`;
- the same assertions run in the reverse direction;
- before/after counts for `ai_interactions` and `ai_memories` are identical for both workspaces;
- no request reaches the AI persistence path, so no AI interaction or memory row is created.

The workflow refuses to run unless the operator supplies:

`SMART_CRM_AI_SCOPE_QA`

This test may consume the normal AI rate-limit counter for the foreign-record probes because rate limiting occurs before scoped-record validation. It must not create CRM data, AI interaction rows, AI memory rows, tasks, activities, notes, or outbound deliveries.

After this gate passes in production, the current E2E regression foundation is considered complete. Future mutation tests remain separate, explicitly gated work and must not be added to default PR CI without a deterministic reset strategy.

## CI secrets

The automated regression program uses these GitHub Actions repository secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `E2E_PRIMARY_EMAIL`
- `E2E_PRIMARY_PASSWORD`
- `E2E_SECONDARY_EMAIL`
- `E2E_SECONDARY_PASSWORD`

The outbound duplicate replay additionally requires:

- `OUTBOUND_EMAIL_INGRESS_TOKEN`

Use two non-platform-admin accounts in different single-workspace tenants. Do not use the platform-admin identity for either side of the isolation proof.

## Commands

Default non-destructive suite:

```bash
npm run test:e2e
npm run test:e2e:public
npm run test:e2e:auth
npm run test:e2e:tenant
```

Controlled read-only preflight:

```text
CONTROLLED_REGRESSION_CONFIRMATION=SMART_CRM_SYNTHETIC_QA_ONLY
```

```bash
npm run test:e2e:controlled
```

Controlled outbound duplicate replay:

```text
OUTBOUND_IDEMPOTENCY_CONFIRMATION=SMART_CRM_OUTBOUND_DUPLICATE_QA
OUTBOUND_EMAIL_INGRESS_TOKEN=<GitHub Actions secret only>
```

```bash
npm run test:e2e:outbound-idempotency
```

Controlled AI scope boundary:

```text
AI_SCOPE_CONFIRMATION=SMART_CRM_AI_SCOPE_QA
```

```bash
npm run test:e2e:ai-scope
```

Prefer the manual GitHub Actions workflows so confirmations and audit trails are captured centrally.
