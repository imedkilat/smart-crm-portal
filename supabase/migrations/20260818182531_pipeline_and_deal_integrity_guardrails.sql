create or replace function private.assign_default_pipeline_stage_to_lead()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.pipeline_stage_id is null and new.workspace_id is not null then
    select ps.id
      into new.pipeline_stage_id
    from public.pipelines p
    join public.pipeline_stages ps on ps.pipeline_id = p.id
    where p.workspace_id = new.workspace_id
      and p.is_default = true
      and ps.stage_type = 'open'
    order by ps.position asc
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_default_pipeline_stage on public.leads;
create trigger trg_assign_default_pipeline_stage
before insert on public.leads
for each row execute function private.assign_default_pipeline_stage_to_lead();

create or replace function private.validate_deal_scope()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  pipeline_workspace uuid;
  stage_workspace uuid;
  stage_pipeline uuid;
  contact_workspace uuid;
  company_workspace uuid;
begin
  select workspace_id into pipeline_workspace from public.pipelines where id = new.pipeline_id;
  select workspace_id, pipeline_id into stage_workspace, stage_pipeline from public.pipeline_stages where id = new.pipeline_stage_id;

  if pipeline_workspace is null or stage_workspace is null then
    raise exception 'Invalid pipeline or pipeline stage';
  end if;
  if pipeline_workspace <> new.workspace_id or stage_workspace <> new.workspace_id or stage_pipeline <> new.pipeline_id then
    raise exception 'Deal pipeline and stage must belong to the same workspace and pipeline';
  end if;

  if new.primary_contact_id is not null then
    select workspace_id into contact_workspace from public.contacts where id = new.primary_contact_id;
    if contact_workspace is distinct from new.workspace_id then
      raise exception 'Primary contact must belong to the deal workspace';
    end if;
  end if;

  if new.company_id is not null then
    select workspace_id into company_workspace from public.companies where id = new.company_id;
    if company_workspace is distinct from new.workspace_id then
      raise exception 'Company must belong to the deal workspace';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_deal_scope on public.deals;
create trigger trg_validate_deal_scope
before insert or update of workspace_id, pipeline_id, pipeline_stage_id, primary_contact_id, company_id on public.deals
for each row execute function private.validate_deal_scope();

create or replace function private.validate_deal_contact_scope()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  deal_workspace uuid;
  contact_workspace uuid;
begin
  select workspace_id into deal_workspace from public.deals where id = new.deal_id;
  select workspace_id into contact_workspace from public.contacts where id = new.contact_id;
  if deal_workspace is null or contact_workspace is null or deal_workspace <> new.workspace_id or contact_workspace <> new.workspace_id then
    raise exception 'Deal and contact must belong to the same workspace';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_deal_contact_scope on public.deal_contacts;
create trigger trg_validate_deal_contact_scope
before insert or update on public.deal_contacts
for each row execute function private.validate_deal_contact_scope();;
