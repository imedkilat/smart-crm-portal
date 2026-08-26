create or replace function public.normalize_manual_lead_created_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.source = 'Manual Add'
     and new.created_at is not null
     and new.created_at = date_trunc('day', new.created_at) then
    new.created_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_manual_lead_created_at on public.leads;
create trigger trg_normalize_manual_lead_created_at
before insert on public.leads
for each row
execute function public.normalize_manual_lead_created_at();;
