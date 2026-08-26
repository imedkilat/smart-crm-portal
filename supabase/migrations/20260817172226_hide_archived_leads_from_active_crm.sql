drop policy if exists owner_select_leads on public.leads;
create policy owner_select_leads on public.leads
for select to authenticated
using (
  (select ((auth.jwt() -> 'app_metadata') ->> 'role')) = 'owner'
  and archived_at is null
);;
