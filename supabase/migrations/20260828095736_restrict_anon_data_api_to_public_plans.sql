-- Remove unauthenticated Data API access to CRM/business data.
-- Supabase Auth endpoints are separate from PostgREST table grants, so
-- signup/login remain unaffected by these table-level revocations.
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;

-- Public pricing remains intentionally readable before sign-in.
grant select on table public.plans to anon;
