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

## Current phase: Phase 3 controlled automation regression

Phase 3 starts with a manual-only, read-only production preflight before any new write-capable regression is added.

The preflight authenticates both configured QA identities, discovers the one workspace named `Smart CRM Starter QA`, and refuses to proceed unless the operator supplies the exact confirmation phrase:

`SMART_CRM_SYNTHETIC_QA_ONLY`

The preflight verifies these production safety invariants without insert/update/delete calls:

- Follow-Up settings remain enabled only for the known Starter QA baseline and `max_tasks_per_run = 1`;
- outbound email remains `enabled = false`, `mode = disabled`, provider unset, and run cap = 1;
- quote alerts remain disabled;
- the synthetic Hot lead `followup.qa.lead@qatest.example.com` exists and is not archived;
- exactly one deterministic Follow-Up task baseline exists for that lead and its automation key/marker are intact;
- exactly one matching `task_created` activity references that automated task;
- controlled quote `QA-QUOTE-001` remains USD 4,200, status `sent`, with both sent and next-follow-up timestamps;
- exactly one quote-created and one quote-updated activity remain scoped to that quote;
- outbound idempotency baseline `qa-outbound-sim-20260901-001` still resolves to exactly one simulated logical delivery and one simulated attempt;
- both outbound records retain `network_call_performed = false` and no provider message ID.

This preflight runs only through the manual `Controlled E2E regression` GitHub Actions workflow. Normal pull-request CI only syntax-checks the controlled harness; it does not execute it.

### Next Phase 3 gates

After the read-only preflight is merged and proven on `main`, add write-capable gates one at a time:

1. Follow-Up shadow selection proof with writes disabled.
2. One controlled Follow-Up write creates exactly one task + one activity, followed by same-day idempotency proof.
3. Quote lifecycle mutation on a dedicated disposable/synthetic fixture with explicit post-test evidence and no accidental alert delivery.
4. Outbound simulation creates exactly one logical delivery + one simulated attempt with `network_call_performed=false`, then repeats the same idempotency key and proves no duplicate attempt.

Write-capable checks must stay manual-only, bounded to synthetic QA fixtures, and must never be enabled automatically on every pull request.

## Phase 4: AI scoped-context smoke

For a fixed QA workspace with deterministic fixture data:

- AI Brain loads only tenant-scoped context;
- prompt execution returns a successful response shape;
- no foreign workspace identifiers or records appear;
- failures are surfaced as test failures without retrying writes.

Avoid brittle exact-text assertions on model prose. Assert scope, record identity, response status, and required structured fields instead.

## CI secrets

The automated regression program uses these GitHub Actions repository secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `E2E_PRIMARY_EMAIL`
- `E2E_PRIMARY_PASSWORD`
- `E2E_SECONDARY_EMAIL`
- `E2E_SECONDARY_PASSWORD`

Use two non-platform-admin accounts in different single-workspace tenants. Do not use the platform-admin identity for either side of the isolation proof.

No additional secret is required for the Phase 3 read-only preflight. Future outbound duplicate-replay or simulation execution may require a dedicated test-only ingress secret, but that must be added as a separate explicit gate and must never expose the secret value in logs.

## Commands

Default non-destructive suite:

```bash
npm run test:e2e
npm run test:e2e:public
npm run test:e2e:auth
npm run test:e2e:tenant
```

Controlled preflight requires the existing QA credentials plus:

```text
CONTROLLED_REGRESSION_CONFIRMATION=SMART_CRM_SYNTHETIC_QA_ONLY
```

Then run:

```bash
npm run test:e2e:controlled
```

Prefer the manual `Controlled E2E regression` GitHub Actions workflow so the confirmation and audit trail are captured centrally.
