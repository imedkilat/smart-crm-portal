-- Harden tenant-scoped SECURITY DEFINER RPC boundaries.
-- This migration mirrors the production hardening applied on 2026-08-28.

create or replace function public.match_ai_memories(
  p_workspace_id uuid,
  p_query_embedding extensions.vector(768),
  p_match_count integer default 8,
  p_scope_type text default null,
  p_scope_key text default null
)
returns table (
  id uuid,
  public_id text,
  content text,
  memory_type text,
  scope_type text,
  scope_key text,
  confidence numeric,
  similarity double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    m.public_id,
    m.content,
    m.memory_type,
    m.scope_type,
    m.scope_key,
    m.confidence,
    1 - (m.embedding operator(extensions.<=>) p_query_embedding) as similarity
  from public.ai_memories m
  where m.workspace_id = p_workspace_id
    and (
      (select auth.role()) = 'service_role'
      or private.is_workspace_member(p_workspace_id)
    )
    and m.status = 'active'
    and m.embedding is not null
    and (p_scope_type is null or m.scope_type in ('workspace', p_scope_type))
    and (p_scope_key is null or m.scope_key is null or m.scope_key = p_scope_key)
  order by m.embedding operator(extensions.<=>) p_query_embedding, m.confidence desc, m.updated_at desc
  limit least(greatest(p_match_count, 1), 50);
$$;

create or replace function public.match_ai_memory_documents(
  query_embedding extensions.vector(768),
  match_count integer default 8,
  filter jsonb default '{}'::jsonb
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity double precision
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_workspace_id uuid;
begin
  v_workspace_id := nullif(filter ->> 'workspace_id', '')::uuid;

  if v_workspace_id is null then
    raise exception 'workspace_id filter is required' using errcode = '22023';
  end if;

  if coalesce((select auth.role()) = 'service_role', false) = false
     and not private.is_workspace_member(v_workspace_id) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;

  return query
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.ai_memory_documents d
  where d.workspace_id = v_workspace_id
    and d.embedding is not null
    and d.metadata @> filter
  order by d.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 50);
end;
$$;

-- SECURITY DEFINER functions must not inherit PUBLIC/anon execution.
revoke all on function public.convert_lead_to_deal(bigint, text, numeric, text, text) from public;
revoke all on function public.convert_lead_to_deal(bigint, text, numeric, text, text) from anon;
grant execute on function public.convert_lead_to_deal(bigint, text, numeric, text, text) to authenticated, service_role;

revoke all on function public.match_ai_memories(uuid, extensions.vector, integer, text, text) from public;
revoke all on function public.match_ai_memories(uuid, extensions.vector, integer, text, text) from anon;
grant execute on function public.match_ai_memories(uuid, extensions.vector, integer, text, text) to authenticated, service_role;

revoke all on function public.match_ai_memory_documents(extensions.vector, integer, jsonb) from public;
revoke all on function public.match_ai_memory_documents(extensions.vector, integer, jsonb) from anon;
grant execute on function public.match_ai_memory_documents(extensions.vector, integer, jsonb) to authenticated, service_role;

-- Trigger helper does not need a mutable schema search path.
alter function private.set_updated_at() set search_path = '';
