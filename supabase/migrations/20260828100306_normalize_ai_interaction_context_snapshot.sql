-- Normalize AI interaction context snapshots at the database boundary.
-- n8n may serialize JSON before sending it, which otherwise stores a JSON
-- string scalar inside the jsonb column. Keep the API tolerant while ensuring
-- persisted snapshots are real JSON objects/arrays when parsable.

create or replace function private.normalize_ai_interaction_context_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_json_text text;
begin
  if new.context_snapshot is not null
     and pg_catalog.jsonb_typeof(new.context_snapshot) = 'string' then
    v_json_text := new.context_snapshot #>> '{}';

    if v_json_text is not null
       and pg_catalog.pg_input_is_valid(v_json_text, 'jsonb') then
      new.context_snapshot := v_json_text::jsonb;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_ai_interaction_context_snapshot on public.ai_interactions;
create trigger normalize_ai_interaction_context_snapshot
before insert or update of context_snapshot on public.ai_interactions
for each row
execute function private.normalize_ai_interaction_context_snapshot();

-- Backfill existing valid JSON-string snapshots without touching invalid text.
update public.ai_interactions
set context_snapshot = (context_snapshot #>> '{}')::jsonb
where pg_catalog.jsonb_typeof(context_snapshot) = 'string'
  and (context_snapshot #>> '{}') is not null
  and pg_catalog.pg_input_is_valid(context_snapshot #>> '{}', 'jsonb');
