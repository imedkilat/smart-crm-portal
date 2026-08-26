update public.leads
set archived_at = coalesce(archived_at, now())
where currency_code <> 'USD';

alter table public.leads
  drop constraint if exists leads_currency_usd_only;

alter table public.leads
  add constraint leads_currency_usd_only
  check (currency_code = 'USD') not valid;;
