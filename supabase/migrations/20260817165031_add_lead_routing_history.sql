create table if not exists public.lead_routing_history (
  id uuid primary key default gen_random_uuid(),
  lead_id bigint not null references public.leads(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_at timestamptz not null default now(),
  automation_triggered boolean not null default false,
  automation_result text not null default 'pending',
  event_key text not null unique
);

create index if not exists lead_routing_history_lead_changed_idx
  on public.lead_routing_history (lead_id, changed_at desc);

create index if not exists lead_routing_history_lead_status_idx
  on public.lead_routing_history (lead_id, to_status, changed_at desc);

alter table public.lead_routing_history enable row level security;

drop policy if exists owner_select_lead_routing_history on public.lead_routing_history;
create policy owner_select_lead_routing_history
  on public.lead_routing_history
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

drop policy if exists owner_insert_lead_routing_history on public.lead_routing_history;
create policy owner_insert_lead_routing_history
  on public.lead_routing_history
  for insert
  to authenticated
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

drop policy if exists owner_update_lead_routing_history on public.lead_routing_history;
create policy owner_update_lead_routing_history
  on public.lead_routing_history
  for update
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');;
