# Smart CRM Portal v2 — Current-State Product Audit

**Date:** 2026-08-26
**Branch:** `claude/fix-workspace-members-rls`
**Method:** Static repository inspection only (no live/production testing performed).
**Scope:** Every route, page, component, control, Supabase query/mutation, Edge Function, n8n workflow, environment dependency, and data assumption found in the repo.

> ⚠️ This audit reflects what the **code** does. Nothing here has been executed against production. Any row marked "needs live testing" or "blocked by configuration" is a claim about code intent, not verified behavior. See `QA_REPORT.md` for the (still-unexecuted) test plan.

## Status legend

| # | Status | Meaning |
|---|--------|---------|
| 1 | Implemented and code-verified | Logic is complete and correct by code reading; no external dependency needed to work |
| 2 | Implemented but needs live testing | Code looks complete but correctness depends on live data / services not verifiable statically |
| 3 | Partially implemented | Some of the feature exists; meaningful parts missing |
| 4 | UI-only or placeholder | Visual/static only; no real backend wiring or hardcoded copy |
| 5 | Broken or incorrectly connected | Present but currently fails or is mis-wired |
| 6 | Not implemented | Referenced/expected but absent from the codebase |
| 7 | Blocked by configuration or external service | Code exists but cannot function without secrets/credentials/published workflows |

---

## Architecture at a glance

- **Frontend:** React 19 + TypeScript + Vite SPA. Client-side routing is **path-based via `window.location`** in `src/main.tsx` (no React Router). Only three real routes exist: `/login`, `/reset-password`, and everything else → the authed app shell. In-app "pages" are **local state** (`useState<Page>` in `src/App.tsx:103`), not URLs.
- **Auth:** Supabase Auth (email/password) using the **publishable/anon key + user session** (`src/lib/supabase.ts`). Access is single-owner in practice; automation is gated on `app_metadata.role === 'owner'` inside the Edge Functions.
- **Data:** Supabase Postgres, tables `leads`, `lead_routing_history`, `insights`, `weekly_summary` (typed in `src/types/database.ts`) plus workspace tables `workspaces`, `workspace_members` (not typed; enforced by RLS). All reads go through RLS as the `authenticated` role.
- **Automation gateway:** Two Supabase Edge Functions (`crm-lead-intake`, `crm-status-route`) act as authenticated proxies to n8n, injecting a private ingress token with the **service-role key** (`supabase/functions/*`). The browser never sees the n8n token.
- **n8n:** 5 exported workflow JSONs under `n8n/workflows/` (intake+Gemini, status router, follow-up engine, weekly summary, report API). These are **reference exports**; their live/published state and credentials are external and unverifiable here.
- **There are no Vercel serverless/API routes.** `vercel.json` only does SPA rewrite. "API" = Supabase Edge Functions + n8n webhooks.

---

## Feature inventory

### Authentication & session

| Page | Feature / control | Frontend impl | Backend / data | External dep | Evidence | Status | Known gap / risk | Recommended next action | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Login | Email/password sign-in | Full form + validation | `supabase.auth.signInWithPassword` | Supabase Auth | `pages/Login.tsx:44`, `lib/auth.ts:31` | 2 | Needs valid user + env keys to test | Live sign-in test with real owner account | P0 |
| Login | Forgot / reset request | Full form | `supabase.auth.resetPasswordForEmail` → email | Supabase Auth SMTP | `lib/auth.ts:42`, `Login.tsx:55` | 2 | Sends a real email; SMTP must be configured | Verify redirect + email delivery in staging | P1 |
| Login | "Invite-only" note, AI preview card ($12.5k) | Static copy | none | none | `Login.tsx:126-145,223` | 4 | Decorative sample data; clearly labeled "Example only" | Keep as-is (labeled) | P3 |
| Reset Password | Set new password | Full form + 8-char/confirm checks | `supabase.auth.updateUser` | Supabase recovery session | `pages/ResetPassword.tsx:13`, `lib/auth.ts:52` | 2 | Requires valid recovery session from email link | Test end-to-end from reset email | P1 |
| Session | Route guard / redirect | `getSession` + `onAuthStateChange` | Supabase Auth | Supabase | `main.tsx:41-93` | 1 | Redirect logic is client-only (SPA) | — | P2 |
| Session | Sign out button | Full | `supabase.auth.signOut` | Supabase | `main.tsx:95`, `lib/auth.ts:59` | 1 | — | — | P2 |

### Dashboard

| Page | Feature / control | Frontend impl | Backend / data | External dep | Evidence | Status | Known gap / risk | Recommended next action | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Dashboard | KPI cards (total/hot/warm/cold), pipeline value | Full, computed client-side | `leads` select (RLS) | Supabase | `App.tsx:125-183,337` | 2→5 | **Currently blocked by RLS recursion** until migration 0002 applied; then code-verified | Apply 0002, retest | P0 |
| Dashboard | Pipeline mix / distribution bars | Full client calc | `leads` | Supabase | `App.tsx:399-413` | 1 | Pure derived UI | — | P2 |
| Dashboard | "Automation pipeline" 5-step diagram | Static array | none | none | `App.tsx:46-52,358` | 4 | Illustrative, not live status | Label as illustrative (minor) | P3 |
| Dashboard | AI intelligence blurb | Reads latest `weekly_summary.ai_summary` | `weekly_summary` | Supabase + n8n weekly job | `App.tsx:382` | 2 | Empty until weekly workflow runs | Confirm after a weekly run | P2 |
| Dashboard | Recent leads table → open drawer | Full | `leads` | Supabase | `App.tsx:439-480` | 2 | Depends on lead read | Retest post-0002 | P1 |
| Dashboard | "Weekly report" / "Add lead" buttons | Switch page state | none | none | `App.tsx:326-331` | 1 | — | — | P3 |

### Leads

| Page | Feature / control | Frontend impl | Backend / data | External dep | Evidence | Status | Known gap / risk | Recommended next action | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Leads | Live list + search + category filter + sort | Full | `leads` select (archived_at null) | Supabase | `pages/LeadsPage.tsx:65-115` | 2→5 | Blocked by RLS recursion now | Apply 0002, retest | P0 |
| Leads | Refresh button | Full | `leads` | Supabase | `LeadsPage.tsx:192` | 1 | — | — | P2 |
| Leads | Archive lead (row action) | Full, `confirm()` dialog | `leads` update `archived_at` | Supabase | `LeadsPage.tsx:132-154` | 2 | Requires UPDATE RLS pass | Test as owner post-0002 | P1 |
| Leads | Row → Lead Profile drawer | Full | see drawer | Supabase | `LeadsPage.tsx:205,224` | 2 | — | — | P1 |

### Lead Profile Drawer (shared component)

| Page | Feature / control | Frontend impl | Backend / data | External dep | Evidence | Status | Known gap / risk | Recommended next action | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Drawer | View details / badges / AI summary (read-only) | Full | `leads` | Supabase | `components/LeadProfileDrawer.tsx:312-362` | 1 | — | — | P2 |
| Drawer | Edit name/email/budget/currency | Full form | `leads` update | Supabase | `LeadProfileDrawer.tsx:194-234` | 2 | Needs UPDATE RLS pass | Test post-0002 | P1 |
| Drawer | Change routing status → triggers automation | Full, with 24h duplicate suppression + history logging | `crm-status-route` Edge Fn → n8n; `lead_routing_history` insert | Supabase Edge Fn + n8n + secrets | `LeadProfileDrawer.tsx:134-283` | 2→7 | Automation path needs owner role, ingress token, published n8n status router | Live test whole route; verify history rows | P0 |
| Drawer | "Email lead" button | `mailto:` link (or disabled if no email) | none | user's mail client | `LeadProfileDrawer.tsx:322-326` | 1 | Not an in-app send; opens local client | Clarify in portfolio copy | P2 |
| Drawer | Refresh record | Full | `leads` single | Supabase | `LeadProfileDrawer.tsx:111-132` | 2 | — | — | P2 |
| Drawer | Routing history list | Full | `lead_routing_history` | Supabase | `LeadProfileDrawer.tsx:97-109,364-387` | 2 | Empty until a status change logged | Test post-0002 | P1 |

### Add Lead (intake)

| Page | Feature / control | Frontend impl | Backend / data | External dep | Evidence | Status | Known gap / risk | Recommended next action | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Add Lead | Manual lead form | Full | `crm-lead-intake` Edge Fn → n8n (Gemini) → Supabase | Edge Fn + n8n + Gemini + secrets | `pages/AddLeadPage.tsx:26-54`, `lib/secureFunctions.ts:16` | 2→7 | Needs owner role + `N8N_LEAD_INGRESS_TOKEN` + published intake workflow + Gemini creds | End-to-end intake test; confirm row appears | P0 |
| Add Lead | Excel `.xlsx` bulk upload | Full, FormData | same gateway | Edge Fn + n8n `extractFromFile` | `AddLeadPage.tsx:56-89` | 2→7 | Same deps; n8n must parse workbook | Test with sample .xlsx | P1 |
| Add Lead | Currency selector (USD/PHP) | Full | passed to workflow | n8n mapping | `AddLeadPage.tsx:131-135` | 2 | Only 2 currencies; classifier must respect it | Confirm currency stored unconverted | P2 |
| Add Lead | "What happens next" steps | Static | none | none | `AddLeadPage.tsx:164-174` | 4 | Illustrative | — | P3 |

### Automation / Run Log

| Page | Feature / control | Frontend impl | Backend / data | External dep | Evidence | Status | Known gap / risk | Recommended next action | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Automation | Run-log table + KPIs (started/suppressed/failed) | Full | `lead_routing_history` + `leads` | Supabase | `pages/AutomationPage.tsx:46-92` | 2→5 | Blocked by RLS recursion now; data written by app during status changes | Apply 0002; generate events; retest | P1 |
| Automation | Result/route filters | Full client filter | in-memory | none | `AutomationPage.tsx:75-79` | 1 | — | — | P2 |
| Automation | Row → drawer | Full | — | Supabase | `AutomationPage.tsx:145,167` | 2 | — | — | P2 |

### Analytics

| Page | Feature / control | Frontend impl | Backend / data | External dep | Evidence | Status | Known gap / risk | Recommended next action | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Analytics | Source / intent / trend / budget breakdowns | Full client-side calc | `leads` (shared via App state) | Supabase | `App.tsx:492-707` | 1→5 | Math is code-verified; **data read blocked by RLS now** | Apply 0002; sanity-check numbers | P1 |
| Analytics | Avg budget, "mixed currencies" handling | Full | derived | none | `App.tsx:558-561,587` | 1 | Only meaningful with single currency | — | P2 |
| Analytics | AI weekly readout | `weekly_summary.ai_summary` | Supabase + n8n | n8n weekly job | `App.tsx:698` | 2 | Empty until weekly run | — | P2 |

### Reports

| Page | Feature / control | Frontend impl | Backend / data | External dep | Evidence | Status | Known gap / risk | Recommended next action | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Reports | Weekly snapshot list (v2/legacy aware) | Full | `weekly_summary` select | Supabase + n8n weekly job | `pages/ReportsPage.tsx:33-66` | 2 | Empty until n8n weekly-summary writes a row | Trigger weekly workflow; verify | P1 |
| Reports | Week-over-week deltas, v1/v2 compatibility | Full client logic | `weekly_summary` fields | Supabase | `ReportsPage.tsx:17-78,120-156` | 1 | Complex versioning; verify against real rows | Validate math on real data | P2 |
| Reports | **PDF generation / export** | — | — | — | none found | 6 | **Not implemented anywhere** in the repo | Decide if in scope; do not advertise | P2 |

### Settings & Archive

| Page | Feature / control | Frontend impl | Backend / data | External dep | Evidence | Status | Known gap / risk | Recommended next action | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Settings | DB health card (counts) | Full | `leads`/`lead_routing_history` count queries | Supabase | `pages/SettingsPage.tsx:44-58` | 2→5 | Blocked by RLS recursion now | Apply 0002; retest | P1 |
| Settings | n8n webhook "configured" cards | Displays env/hardcoded URL | `import.meta.env` or fallback | none | `SettingsPage.tsx:6-7,99-108` | 4 | **Always shows "configured"** even if webhook down; does not ping n8n | Reword to "endpoint set" not "healthy" | P2 |
| Settings | Routing policy list (Hot/Warm/Cold/24h/Cal) | Static descriptive rows | none | none | `SettingsPage.tsx:118-124` | 4 | Hardcoded "Active/Off" states, not read from n8n | Label as descriptive policy | P2 |
| Settings | Owner identity (email/role) | Full | `supabase.auth.getUser` | Supabase | `SettingsPage.tsx:55-56,131-133` | 1 | Role shows "Authenticated user" if `role` unset | Confirm owner role set on account | P1 |
| Archive | List archived + search + restore | Full | `leads` (archived) update | Supabase | `pages/ArchivePage.tsx:40-113` | 2 | Needs RLS pass | Test post-0002 | P2 |

### Global search

| Page | Feature / control | Frontend impl | Backend / data | External dep | Evidence | Status | Known gap / risk | Recommended next action | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Topbar | Ctrl/⌘-K global lead search | Full, scored, keyboard nav | `leads` select (all, filters archived client-side) | Supabase | `components/GlobalSearch.tsx:63-149` | 2→5 | Blocked by RLS recursion now; loads full lead set into client | Apply 0002; retest | P2 |

### Backend — Supabase Edge Functions

| Area | Feature / control | Impl | Data | External dep | Evidence | Status | Known gap / risk | Recommended next action | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Edge | `crm-lead-intake` auth proxy | Verifies Bearer + owner role, forwards to n8n with ingress token | Supabase admin `getUser` | `SUPABASE_SERVICE_ROLE_KEY`, `N8N_LEAD_INGRESS_TOKEN`, n8n URL | `supabase/functions/crm-lead-intake/index.ts` | 7 | Hard-fails 500 without secrets; owner-gated 403 otherwise | Set secrets in Supabase; deploy; live test | P0 |
| Edge | `crm-status-route` auth proxy | Same pattern | Supabase admin `getUser` | `SUPABASE_SERVICE_ROLE_KEY`, `N8N_STATUS_INGRESS_TOKEN` | `supabase/functions/crm-status-route/index.ts` | 7 | Same | Set secrets; deploy; live test | P0 |
| Edge | Deployment state of functions | — | — | Supabase | not in repo | 7 | Cannot confirm functions are deployed | Verify in Supabase dashboard | P0 |

### Backend — RLS / data model

| Area | Feature / control | Impl | Evidence | Status | Known gap / risk | Recommended next action | Priority |
|---|---|---|---|---|---|---|---|
| RLS | Workspace-scoped policies on all tables | Present in prod (not previously in repo) | prod `pg_policies` diagnostic; `supabase/migrations/0001_*` snapshot | 5 | **Infinite recursion** breaks every read in production right now | Apply `0002_fix_workspace_members_rls.sql` | P0 |
| RLS | Recursion fix (SECURITY DEFINER helpers) | Written, committed, **not applied** | `supabase/migrations/0002_*` (commit 7432951) | 2 | Not yet run on prod; needs dry-run + verify | Dry-run + apply + verify per fix instructions | P0 |
| Data | `leads.workspace_id` backfill | `assign_single_workspace_to_lead` trigger/function in prod | prod `pg_proc` diagnostic | 2 | Null `workspace_id` leads are invisible under RLS | Confirm all live leads have workspace_id | P1 |
| Data | `pipeline_stage_id`, `converted_contact/company/deal_id`, `converted_at` on `leads` | Columns exist; **no app code reads/writes them** | `leads` columns in diagnostic; no TS references | 6 | Schema anticipates a pipeline/CRM-object model that the app does not implement | Decide scope; build or defer | P2 |

### External automation — n8n workflows (reference exports)

| Workflow file | Purpose | Key nodes | Status | Known gap / risk | Priority |
|---|---|---|---|---|---|
| `lead-intake-classification.json` | Webhook → Gemini agent classify → Supabase insert (also Airtable, .xlsx extract) | webhook `799b1d66…`, langchain agent + Gemini, `supabase`, `extractFromFile`, `airtable` | 7 | Needs Gemini + Supabase + Airtable creds; published; matches Edge Fn URL | P0 |
| `lead-status-router.json` | Webhook → If Hot/Warm → Gmail + Google Calendar + wait | webhook `smart-crm-status-route`, `gmail`, `googleCalendar`, `if`, `wait` | 7 | Needs Gmail + Calendar creds; **sends real emails/events** | P0 |
| `crm-follow-up-engine.json` | Google Sheets trigger → Gmail follow-ups + Calendar | `googleSheetsTrigger`, `gmail`, `googleCalendar`, `wait` | 7 | Sheets-triggered, parallel/legacy path; not wired to the app gateway | P2 |
| `crm-weekly-summary.json` | Monday 8AM schedule → HTTP get metrics → Gemini commentary → save `weekly_summary` | `scheduleTrigger`, `httpRequest`, Gemini, `set` | 7 | Populates Reports/Analytics AI text; needs creds + published | P1 |
| `report-api.json` | Webhook `smartcrm-report` → returns **static** Set data | `webhook`, `function`, `set` | 4 | Returns hardcoded/mock JSON; **app does not call it** (reads `weekly_summary` directly) | P3 |

### Environment variables

| Variable | Where | Required? | Evidence | Status / risk |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | frontend | Yes | `lib/supabase.ts:4`, `.env.example` | App inert without it (`isSupabaseConfigured=false`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | frontend | Yes | `lib/supabase.ts:5` | Same |
| `VITE_N8N_LEAD_WEBHOOK_URL` | frontend | Optional (display only) | `SettingsPage.tsx:6` | Falls back to hardcoded prod URL |
| `VITE_N8N_STATUS_WEBHOOK_URL` | frontend | Optional (display only) | `SettingsPage.tsx:7` | Falls back to hardcoded prod URL |
| `SUPABASE_URL` | Edge Fn | Yes | `functions/*/index.ts:32` | 500 if missing |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Fn | Yes | `functions/*/index.ts:33` | 500 if missing; server-only (never in client) ✅ |
| `N8N_LEAD_INGRESS_TOKEN` | Edge Fn | Yes | `crm-lead-intake/index.ts:34` | 500 if missing |
| `N8N_STATUS_INGRESS_TOKEN` | Edge Fn | Yes | `crm-status-route/index.ts:34` | 500 if missing |

> Note: `.env.example` documents only the two `VITE_` keys. The four server-side secrets are **not** documented anywhere in the repo — an onboarding gap.

---

## Features the prompt asked about that are absent

These were named in the audit request but are **not present** in the application:

| Requested feature | Finding | Status |
|---|---|---|
| Pipeline page / pipeline stage mutations | No pipeline UI, no `pipeline_stages` table typed, no stage read/write code. Only an unused `leads.pipeline_stage_id` column exists in the DB | 6 (Not implemented) |
| Task creation / completion | No tasks table, page, or handlers anywhere | 6 (Not implemented) |
| "AI Brain" | No component, route, or reference by that name | 6 (Not implemented) |
| Reports PDF generation | No PDF library or export code | 6 (Not implemented) |
| Contacts / Companies / Deals (CRM objects) | `leads.converted_contact_id/company_id/deal_id/converted_at` columns exist but nothing reads/writes them; no UI | 6 (Not implemented) |
| In-app email / calendar sending | App only opens a `mailto:` link; real sends happen in n8n (Gmail/Calendar nodes) | 3 (Partial, external) |

---

## Placeholders / static / hardcoded values (not bugs, but not "live")

- Owner name **"Ed Rowell Kilat" / "EK"** is hardcoded in the top bar (`App.tsx:233-236`) regardless of who signs in.
- Dashboard greeting **"Good morning, Ed"** is hardcoded (`App.tsx:322`).
- Login AI preview card (**$12.5k**, "Hot Lead") is labeled "Example only" (`Login.tsx:138-144`).
- Settings n8n cards always render **"Production endpoint configured"** and routing policy states are **static** (`SettingsPage.tsx:99-124`) — they do not probe n8n health.
- Automation "pipeline" and Add-Lead "what happens next" step diagrams are **static arrays**.
- Default n8n webhook URLs are **hardcoded fallbacks** in `SettingsPage.tsx` and inside both Edge Functions.
