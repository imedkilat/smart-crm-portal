create or replace function public.set_default_lead_routing_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.routing_status is null and new.category is not null then
    new.routing_status := new.category;
  end if;
  return new;
end;
$$;

drop trigger if exists set_default_lead_routing_status on public.leads;
create trigger set_default_lead_routing_status
before insert on public.leads
for each row
execute function public.set_default_lead_routing_status();;
