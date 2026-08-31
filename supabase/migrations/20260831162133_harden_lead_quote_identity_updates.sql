-- Allow the quote lifecycle UI to resubmit immutable quote identity fields
-- without permitting a quote to move across workspaces or leads.

create or replace function private.enforce_lead_quote_identity_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace_id is immutable for lead_quotes' using errcode = '22023';
  end if;
  if new.lead_id is distinct from old.lead_id then
    raise exception 'lead_id is immutable for lead_quotes' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_lead_quote_identity_immutable() from public;
revoke all on function private.enforce_lead_quote_identity_immutable() from anon;
revoke all on function private.enforce_lead_quote_identity_immutable() from authenticated;

drop trigger if exists trg_lead_quotes_identity_immutable on public.lead_quotes;
create trigger trg_lead_quotes_identity_immutable
before update on public.lead_quotes
for each row execute function private.enforce_lead_quote_identity_immutable();

grant update (workspace_id, lead_id) on table public.lead_quotes to authenticated;
