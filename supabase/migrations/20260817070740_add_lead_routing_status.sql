alter table public.leads
  add column if not exists routing_status text,
  add column if not exists status_changed_at timestamptz;

update public.leads
set routing_status = category
where routing_status is null and category is not null;

alter table public.leads
  drop constraint if exists leads_routing_status_check;

alter table public.leads
  add constraint leads_routing_status_check
  check (routing_status is null or routing_status in ('Hot','Warm','Cold'));

comment on column public.leads.category is 'AI-generated lead classification from intake. Treat as immutable in the CRM UI.';
comment on column public.leads.routing_status is 'Human-controlled operational routing status. Status changes may trigger n8n follow-up automation.';
comment on column public.leads.status_changed_at is 'Timestamp of the latest routing status change.';;
