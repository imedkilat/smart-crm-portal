# Smart CRM E2E regression strategy

## Goal

Catch regressions in the highest-risk product paths without turning the test suite into an uncontrolled production writer.

## Safety rules

- Pull-request CI runs non-destructive browser checks by default.
- Authenticated smoke tests are credential-gated and read-only.
- Never store test credentials in the repository.
- Never create, update, or delete production leads, quotes, tasks, subscriptions, memberships, or outbound deliveries from the default PR suite.
- Mutation tests must use dedicated synthetic QA fixtures, explicit idempotency keys, bounded write counts, and post-test verification.
- Cross-tenant tests must prove denied access without granting temporary memberships or weakening RLS.

## Current phase: foundation

Automated now:

1. Protected routes redirect unauthenticated users to `/login`.
2. Sign-in required-field validation remains intact.
3. Workspace signup keeps full-name, workspace-name, email, password, and confirmation requirements.
4. Password recovery entry remains reachable.
5. When GitHub Actions secrets are configured, an existing QA account can sign in and read `/dashboard`, `/quotes`, and `/ai-brain` without writes.

## Phase 2: tenant isolation

Add two dedicated QA identities in separate workspaces and verify:

- each account resolves only its own workspace context;
- workspace A cannot read workspace B leads, quotes, tasks, settings, or activities;
- direct Supabase queries using each authenticated session return zero foreign-tenant rows;
- protected routes do not leak another tenant's cached UI state.

No membership mutation is allowed inside the test itself.

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

Optional authenticated smoke tests use GitHub Actions secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `E2E_PRIMARY_EMAIL`
- `E2E_PRIMARY_PASSWORD`

If these are absent, credential-gated tests skip while public regression tests still run.

## Local commands

```bash
npm run test:e2e
npm run test:e2e:public
npm run test:e2e:auth
```

Playwright starts a local production build automatically unless `E2E_BASE_URL` is supplied.
