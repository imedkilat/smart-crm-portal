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

### Current gate: outbound duplicate/idempotency replay

The first controlled write-capable-system regression exercises the real `crm-outbound-email` Edge Function without creating new data.

Why this gate comes before quote mutation:

- authenticated members have INSERT/SELECT/UPDATE access to `lead_quotes`, but no DELETE policy;
- `lead_activities` also has no DELETE policy;
- therefore a repeatable quote create/update test would permanently accumulate QA rows unless the regression bypassed normal RLS with privileged cleanup, which is intentionally not allowed.

The outbound replay instead uses the already-existing synthetic logical delivery with idempotency key:

`qa-outbound-sim-20260901-001`

The manual workflow must refuse to run unless the operator supplies:

`SMART_CRM_OUTBOUND_DUPLICATE_QA`

The harness must prove all of the following:

- `Smart CRM Starter QA` is the only configured QA session for the target tenant;
- outbound settings remain `enabled = false`, `mode = disabled`, provider unset, and run cap = 1;
- the existing delivery is still simulated, has `attempt_count = 1`, no provider message ID, and `network_call_performed = false`;
- the real Edge Function returns HTTP 200 with `duplicate = true` for the same logical key;
- the returned delivery public ID is the existing delivery;
- total delivery and attempt counts do not change;
- the fixture still has exactly one attempt after replay;
- outbound settings remain disabled after replay;
- no provider call occurs.

This gate requires the existing Supabase Edge Function secret to be mirrored into GitHub Actions as repository secret `OUTBOUND_EMAIL_INGRESS_TOKEN`. The value must never be committed or printed.

### Later Phase 3 gates

1. Follow-Up shadow selection proof with writes disabled.
2. One controlled Follow-Up write + same-day idempotency proof, only after a repeatable cleanup/reset strategy exists.
3. Quote lifecycle mutation only after a disposable fixture or non-bypass cleanup design exists.
4. Fresh outbound simulation only when a bounded reset strategy exists; until then the duplicate replay is the repeatable production-safe contract.

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

Prefer the manual GitHub Actions workflows so confirmations and audit trails are captured centrally.
