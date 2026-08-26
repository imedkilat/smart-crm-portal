# Smart CRM Portal v2 — QA Report

**Date opened:** 2026-08-26
**Branch:** `claude/fix-workspace-members-rls`
**Status of this report:** 🟡 **Structure only — nothing has been tested yet.**

> ❗ No test below has been executed. Every "Actual result" is `NOT YET TESTED` and every "Verification result" is `PENDING`. Do not treat any feature as passing until its row is filled in from a real run. Severity is a *risk estimate* until confirmed.

## How to use this report

For every test, capture all of these fields:

- **Test ID** — stable identifier (e.g. `QA-DASH-01`)
- **Feature** — what is under test
- **Preconditions** — required state (signed in as owner, migration applied, n8n published, etc.)
- **Reproduction steps** — exact clicks / actions
- **Expected result** — what should happen
- **Actual result** — what actually happened (fill after running)
- **Severity** — Blocker / Critical / Major / Minor / Cosmetic
- **Console or network evidence** — errors, failed requests, status codes, screenshots
- **Fix status** — Not started / In progress / Fixed / Won't fix
- **Verification result** — Pass / Fail / Pending (after any fix)

**Severity scale:** Blocker (app unusable) · Critical (core flow broken) · Major (feature broken, workaround exists) · Minor (cosmetic/edge) · Cosmetic (polish).

## Global preconditions (apply to most tests)

- **P-ENV** — Frontend has `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` set.
- **P-RLS** — Migration `0002_fix_workspace_members_rls.sql` has been applied (otherwise all data reads fail with recursion). **Currently NOT applied.**
- **P-OWNER** — Test account exists, is a `workspace_members` row, and has `app_metadata.role = 'owner'`.
- **P-WS** — Test leads have a non-null `workspace_id`.
- **P-EDGE** — Edge Functions deployed with `SUPABASE_SERVICE_ROLE_KEY` + ingress tokens set.
- **P-N8N** — Relevant n8n workflows are published with valid Gemini/Gmail/Calendar/Supabase credentials.

---

## Test cases

### Authentication

| Field | QA-AUTH-01 | QA-AUTH-02 | QA-AUTH-03 |
|---|---|---|---|
| Feature | Sign in | Password reset request | Set new password |
| Preconditions | P-ENV, P-OWNER | P-ENV, SMTP configured | P-ENV, valid recovery link |
| Repro steps | Open `/login`, enter valid creds, Sign in | `/login` → Forgot password → submit email | Open reset link → enter matching 8+ char pw |
| Expected | Redirect to app shell | "Reset link sent" + email arrives | "Password updated" + can sign in with new pw |
| Actual | NOT YET TESTED | NOT YET TESTED | NOT YET TESTED |
| Severity (est.) | Blocker | Major | Major |
| Console/network | — | — | — |
| Fix status | Not started | Not started | Not started |
| Verification | PENDING | PENDING | PENDING |

### Dashboard

| Field | QA-DASH-01 | QA-DASH-02 |
|---|---|---|
| Feature | KPI + recent leads load | Open lead from dashboard |
| Preconditions | P-ENV, P-RLS, P-OWNER, P-WS | same |
| Repro steps | Sign in → land on Dashboard | Click a recent-leads row |
| Expected | KPIs show real counts; no error banner | Lead drawer opens with details |
| Actual | NOT YET TESTED (expected FAIL until P-RLS) | NOT YET TESTED |
| Severity (est.) | Blocker | Major |
| Console/network | Expect `infinite recursion detected in policy for relation "workspace_members"` pre-fix | — |
| Fix status | Fix written (0002), not applied | Not started |
| Verification | PENDING | PENDING |

### Leads

| Field | QA-LEAD-01 | QA-LEAD-02 | QA-LEAD-03 |
|---|---|---|---|
| Feature | List/search/filter/sort | Archive lead | Edit lead in drawer |
| Preconditions | P-ENV, P-RLS, P-OWNER, P-WS | same | same |
| Repro steps | Open Leads; type query; toggle Hot/Warm/Cold; change sort | Click Archive on a row → confirm | Open drawer → Edit → change name/budget → Save |
| Expected | Filtered rows update correctly | Row leaves active list; DB `archived_at` set | Save persists; drawer + list refresh |
| Actual | NOT YET TESTED | NOT YET TESTED | NOT YET TESTED |
| Severity (est.) | Critical | Major | Major |
| Fix status | Not started | Not started | Not started |
| Verification | PENDING | PENDING | PENDING |

### Lead routing (status change → automation)

| Field | QA-ROUTE-01 | QA-ROUTE-02 | QA-ROUTE-03 |
|---|---|---|---|
| Feature | Status change triggers n8n + logs event | 24h duplicate suppression | Automation failure handling |
| Preconditions | P-ENV, P-RLS, P-OWNER, P-EDGE, P-N8N | same + a recent accepted event | P-EDGE misconfigured / n8n down |
| Repro steps | Drawer → Edit → set routing Hot → Save | Repeat same route within 24h | Save routing change while gateway fails |
| Expected | "Saved and routed"; history row `accepted`; **real email/calendar may fire** | "suppressed" warning; history row `suppressed_24h`; no new automation | "automation did not start" warning; history row `failed`; lead still saved |
| Actual | NOT YET TESTED | NOT YET TESTED | NOT YET TESTED |
| Severity (est.) | Critical | Major | Major |
| Console/network | Watch `POST /functions/v1/crm-status-route` status | — | Expect non-2xx from gateway |
| Fix status | Not started | Not started | Not started |
| Verification | PENDING | PENDING | PENDING |

> ⚠️ QA-ROUTE-01 can send **real emails / calendar invites** via n8n. Use a safe test lead/inbox.

### Add Lead (intake + AI classification)

| Field | QA-INTAKE-01 | QA-INTAKE-02 |
|---|---|---|
| Feature | Manual lead → Gemini classify → stored | Excel `.xlsx` bulk intake |
| Preconditions | P-ENV, P-OWNER, P-EDGE, P-N8N (intake + Gemini) | same + valid .xlsx |
| Repro steps | Add Lead → fill form → Classify & add | Choose .xlsx → Upload to workflow |
| Expected | Success message; new lead appears in Leads with category/intent/summary set | Rows classified and inserted |
| Actual | NOT YET TESTED | NOT YET TESTED |
| Severity (est.) | Critical | Major |
| Console/network | Watch `POST /functions/v1/crm-lead-intake` | — |
| Fix status | Not started | Not started |
| Verification | PENDING | PENDING |

### Automation / Run Log

| Field | QA-AUTO-01 |
|---|---|
| Feature | Run-log KPIs + table + filters |
| Preconditions | P-ENV, P-RLS, P-OWNER; at least one routing event |
| Repro steps | Open Automation; apply route/result filters |
| Expected | KPIs and rows match logged events |
| Actual | NOT YET TESTED |
| Severity (est.) | Major |
| Fix status | Not started |
| Verification | PENDING |

### Analytics

| Field | QA-ANALYTICS-01 |
|---|---|
| Feature | Source/intent/trend/budget calculations |
| Preconditions | P-ENV, P-RLS, P-OWNER, P-WS with varied leads |
| Repro steps | Open Analytics |
| Expected | Percentages/totals reconcile with Leads count; mixed-currency handled |
| Actual | NOT YET TESTED |
| Severity (est.) | Major |
| Fix status | Not started |
| Verification | PENDING |

### Reports

| Field | QA-REPORT-01 | QA-REPORT-02 |
|---|---|---|
| Feature | Weekly snapshot rendering | PDF export |
| Preconditions | P-ENV, P-RLS; ≥1 `weekly_summary` row | — |
| Repro steps | Open Reports | Look for export control |
| Expected | Latest + history render; deltas correct | — |
| Actual | NOT YET TESTED | N/A — **feature not implemented** |
| Severity (est.) | Major | Major (missing feature) |
| Fix status | Not started | Not implemented |
| Verification | PENDING | N/A |

### Settings & Archive

| Field | QA-SET-01 | QA-SET-02 | QA-ARCH-01 |
|---|---|---|---|
| Feature | DB health card | Owner identity/role | Archive list + restore |
| Preconditions | P-ENV, P-RLS, P-OWNER | P-OWNER | P-ENV, P-RLS; ≥1 archived lead |
| Repro steps | Open Settings → Refresh health | Read owner card | Settings → Manage archive → Restore a lead |
| Expected | Counts show; "Connected" | Correct email + role `owner` | Lead returns to active views; no automation fired |
| Actual | NOT YET TESTED | NOT YET TESTED | NOT YET TESTED |
| Severity (est.) | Major | Minor | Major |
| Fix status | Not started | Not started | Not started |
| Verification | PENDING | PENDING | PENDING |

### Global search

| Field | QA-SEARCH-01 |
|---|---|
| Feature | Ctrl/⌘-K lead search |
| Preconditions | P-ENV, P-RLS, P-OWNER |
| Repro steps | Press Ctrl/⌘-K; type name/email; arrow + Enter |
| Expected | Ranked matches; Enter opens drawer |
| Actual | NOT YET TESTED |
| Severity (est.) | Minor |
| Fix status | Not started |
| Verification | PENDING |

### Security / RLS

| Field | QA-SEC-01 | QA-SEC-02 |
|---|---|---|
| Feature | Recursion resolved | Cross-workspace isolation |
| Preconditions | P-RLS applied | P-RLS applied; a non-member identity |
| Repro steps | Run verification queries in fix instructions (as `authenticated`) | Query `leads` as a user with no membership |
| Expected | No recursion error; owner sees own rows | Non-member sees 0 rows across all tables |
| Actual | NOT YET TESTED | NOT YET TESTED |
| Severity (est.) | Blocker | Critical |
| Fix status | Fix written (0002), not applied | same |
| Verification | PENDING | PENDING |

---

## Known issues discovered during the static audit (pre-testing)

| ID | Issue | Severity (est.) | Evidence | Fix status |
|---|---|---|---|---|
| KI-01 | RLS infinite recursion breaks all reads in production | Blocker | prod diagnostic; `App.tsx:335` | Fix written in `0002` (commit 7432951), **not applied** |
| KI-02 | Owner name/greeting hardcoded ("Ed Rowell Kilat", "Good morning, Ed") | Minor | `App.tsx:233,322` | Not started |
| KI-03 | Settings shows n8n endpoints as "configured/Active" without probing health | Minor | `SettingsPage.tsx:99-124` | Not started |
| KI-04 | Server-side secrets undocumented in `.env.example` | Minor | `.env.example` | Not started |
| KI-05 | `report-api.json` returns static mock data and is unused by the app | Cosmetic | `n8n/workflows/report-api.json` | Won't fix / defer |
| KI-06 | Pipeline / tasks / AI Brain / PDF export not implemented | Major (scope) | see audit | Product decision needed |
