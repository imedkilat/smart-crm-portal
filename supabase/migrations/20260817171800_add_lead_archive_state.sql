alter table public.leads add column if not exists archived_at timestamptz null;
create index if not exists leads_archived_at_idx on public.leads (archived_at);;
