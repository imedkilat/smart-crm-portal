# Smart CRM E2E regression strategy

## Goal

Catch regressions in the highest-risk product paths without turning the test suite into an uncontrolled production writer.

## Safety rules

- Pull-request CI runs non-destructive checks only.
- Never store test credentials in the repository.
- Never create, update, or delete production leads, quotes, tasks, subscriptions, memberships, or outbound deliveries from the default PR suite.
- Mutation tests must use dedicated synthetic QA fixtures, explicit idempotency keys, bounded write counts, and post-test verification.
- Cross-tenant tests must prove denied access without granting temporary memberships or weakening RLS.

## Phase 1: foundation — merged

Automated now:

1. Protected routes redirect unauthenticated users to `/login`.
2. Sign-in required-field validation remains intact.
3. Workspace signup keeps full-name, workspace-name, email, password, and confirmation requirements.
4. Password recovery entry remains reachable.
5. A configured QA account can sign in and read `/dashboard`, `/quotes`, and `/ai-brain` without writes.
6. GitHub Actions runs Chromium regression CI and retains the Playwright report artifact.

## Current phase: Phase 2 tenant isolation

Use two existing non-platform-admin QA identities that each have exactly one workspace membership. Their emails and passwords stay in GitHub Actions secrets and are never hardcoded into the repository.

Automated contract:

- each account authenticates independently and resolves exactly one visible workspace membership;
- the two workspace IDs must be different;
- each account can read its own workspace row;
- workspace A cannot read workspace B, and workspace B cannot read workspace A;
- direct authenticated Supabase queries must return an empty result for the foreign workspace across:
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

No membership or CRM-data mutation is allowed inside this test.

## Phase 3: controlled automation regression

Use dedicated synthetic fixtures only and keep automation schedules disabled during test setup.

- Follow-Up shadow run selects the expected candidate with writes disabled.
- One controlled follow-up write creates exactly one task + one activity.
- Same-day rerun proves idempotency.
- Quote create/read/update uses exactly one synthetic quote and verifies matching timeline events.
- Outbound email simulation creates one logical delivery + one simulated attempt with `network_call_performed=false`; repeating the same key creates no duplicate attempt.

All write-capable tests require an explicit QA environment/gate and must not run automatically on every pull request.

## Phase 4: AI scoped-context smoke

For a fixed QA workspace with deterministic fixture data:

- AI Brain loads only tenant-scoped context;
- prompt execution returns a successful response shape;
- no foreign workspace identifiers or records appear;
- failures are surfaced as test failures without retrying writes.

Avoid brittle exact-text assertions on model prose. Assert scope, record identity, response status, and required structured fields instead.

## CI secrets

Phase 2 makes the two-tenant QA gate mandatory in regression CI. Configure these GitHub Actions repository secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `E2E_PRIMARY_EMAIL`
- `E2E_PRIMARY_PASSWORD`
- `E2E_SECONDARY_EMAIL`
- `E2E_SECONDARY_PASSWORD`

Use two non-platform-admin accounts in different single-workspace tenants. Do not use the platform-admin identity for either side of the isolation proof.

## Local commands

```bash
npm run test:e2e
npm run test:e2e:public
npm run test:e2e:auth
npm run test:e2e:tenant
```

Playwright starts a local production build automatically unless `E2E_BASE_URL` is supplied.
