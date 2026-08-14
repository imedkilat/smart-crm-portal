# Smart CRM Portal v2 rebuild plan

## Source of truth

The previous WordPress portal and the Claude Design export are visual/functional references. The production rebuild lives in this repository as a maintainable React + TypeScript app.

## Phase 1 — Frontend reconstruction

- Port the approved dashboard design into reusable React components.
- Rebuild Dashboard, Leads, Add Lead, Insights, Reports, Settings and authentication screens.
- Keep responsive behavior and accessibility in the component system.

## Phase 2 — Existing Supabase integration

Current tables discovered in the existing Smart CRM Supabase project:

- `leads`
- `insights`
- `weekly_summary`

Use typed queries and preserve the existing data model while we migrate the UI.

## Phase 3 — Authentication and data security

- Add Supabase Auth: sign in, sign up, password reset and protected routes.
- Introduce user/workspace ownership fields.
- Replace legacy permissive policies with tenant-safe Row Level Security.
- Do not expose service-role credentials in the frontend.

## Phase 4 — Automation integration

Reconnect the n8n workflows for:

1. Lead intake and AI classification
2. Follow-up routing
3. Weekly AI summary/reporting
4. Report API / dashboard data

## Phase 5 — Portfolio-ready deployment

- Deploy frontend to Vercel.
- Add environment variables in the deployment platform.
- Add screenshots, architecture documentation and a polished README.
- Update the portfolio case study with the new live URL only after deployment is healthy.
