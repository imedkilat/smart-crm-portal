alter table public.leads enable row level security;
alter table public.insights enable row level security;
alter table public.weekly_summary enable row level security;

drop policy if exists "Allow anon read" on public.leads;
drop policy if exists "Allow insert for anon" on public.leads;
drop policy if exists "leads_delete_authenticated" on public.leads;
drop policy if exists "leads_insert_authenticated" on public.leads;
drop policy if exists "leads_select_authenticated" on public.leads;
drop policy if exists "leads_update_authenticated" on public.leads;

create policy "owner_select_leads"
on public.leads for select
to authenticated
using ((select auth.jwt()->'app_metadata'->>'role') = 'owner');

create policy "owner_insert_leads"
on public.leads for insert
to authenticated
with check ((select auth.jwt()->'app_metadata'->>'role') = 'owner');

create policy "owner_update_leads"
on public.leads for update
to authenticated
using ((select auth.jwt()->'app_metadata'->>'role') = 'owner')
with check ((select auth.jwt()->'app_metadata'->>'role') = 'owner');

create policy "owner_delete_leads"
on public.leads for delete
to authenticated
using ((select auth.jwt()->'app_metadata'->>'role') = 'owner');

create policy "owner_select_insights"
on public.insights for select
to authenticated
using ((select auth.jwt()->'app_metadata'->>'role') = 'owner');

create policy "owner_all_insights"
on public.insights for all
to authenticated
using ((select auth.jwt()->'app_metadata'->>'role') = 'owner')
with check ((select auth.jwt()->'app_metadata'->>'role') = 'owner');

create policy "owner_select_weekly_summary"
on public.weekly_summary for select
to authenticated
using ((select auth.jwt()->'app_metadata'->>'role') = 'owner');

create policy "owner_all_weekly_summary"
on public.weekly_summary for all
to authenticated
using ((select auth.jwt()->'app_metadata'->>'role') = 'owner')
with check ((select auth.jwt()->'app_metadata'->>'role') = 'owner');;
