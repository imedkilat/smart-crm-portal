create or replace function public.normalize_manual_lead_created_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.source in ('Manual Add', 'Excel File')
     and new.created_at is not null
     and new.created_at = date_trunc('day', new.created_at) then
    new.created_at := now();
  end if;
  return new;
end;
$function$;;
