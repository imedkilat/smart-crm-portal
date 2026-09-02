-- Performance advisor fix: wrap auth.uid() in a scalar subquery so Postgres
-- evaluates it once per query instead of once per row.
drop policy if exists "usage_counters_member_read" on public.usage_counters;
create policy "usage_counters_member_read" on public.usage_counters
  for select using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = usage_counters.workspace_id
        and wm.user_id = (select auth.uid())
    )
  );
