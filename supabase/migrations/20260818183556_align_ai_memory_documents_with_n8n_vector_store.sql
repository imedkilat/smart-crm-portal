alter table public.ai_memory_documents alter column workspace_id drop not null;

create or replace function private.derive_ai_memory_document_scope()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.workspace_id is null then
    begin
      new.workspace_id := nullif(new.metadata->>'workspace_id','')::uuid;
    exception when others then
      raise exception 'ai_memory_documents metadata.workspace_id must be a valid UUID';
    end;
  end if;

  if new.memory_id is null and nullif(new.metadata->>'memory_id','') is not null then
    begin
      new.memory_id := (new.metadata->>'memory_id')::uuid;
    exception when others then
      raise exception 'ai_memory_documents metadata.memory_id must be a valid UUID';
    end;
  end if;

  if new.workspace_id is null then
    raise exception 'workspace_id is required in vector document metadata';
  end if;

  if new.memory_id is not null then
    if not exists (
      select 1 from public.ai_memories m
      where m.id = new.memory_id and m.workspace_id = new.workspace_id
    ) then
      raise exception 'memory_id does not belong to workspace_id';
    end if;
  end if;

  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('workspace_id', new.workspace_id::text);
  if new.memory_id is not null then
    new.metadata := new.metadata || jsonb_build_object('memory_id', new.memory_id::text);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_derive_ai_memory_document_scope on public.ai_memory_documents;
create trigger trg_derive_ai_memory_document_scope
before insert or update of workspace_id, memory_id, metadata on public.ai_memory_documents
for each row execute function private.derive_ai_memory_document_scope();;
