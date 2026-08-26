alter table public.leads
  add column if not exists currency_code text not null default 'USD';

alter table public.leads
  drop constraint if exists leads_currency_code_check;

alter table public.leads
  add constraint leads_currency_code_check
  check (currency_code ~ '^[A-Z]{3}$');

update public.leads
set currency_code = case
  when budget ~* '(₱|PHP)' then 'PHP'
  else 'USD'
end;

comment on column public.leads.currency_code is 'ISO 4217 currency code for the lead budget. Budget values are never summed across different currencies without explicit conversion.';

create or replace function public.normalize_lead_currency_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.budget is not null then
    if new.budget ~* '(₱|PHP)' then
      new.currency_code := 'PHP';
    elsif new.budget ~* '(\$|USD)' and (new.currency_code is null or btrim(new.currency_code) = '') then
      new.currency_code := 'USD';
    end if;
  end if;

  if new.currency_code is null or btrim(new.currency_code) = '' then
    new.currency_code := 'USD';
  else
    new.currency_code := upper(btrim(new.currency_code));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_lead_currency_code on public.leads;
create trigger trg_normalize_lead_currency_code
before insert or update of budget, currency_code on public.leads
for each row execute function public.normalize_lead_currency_code();;
