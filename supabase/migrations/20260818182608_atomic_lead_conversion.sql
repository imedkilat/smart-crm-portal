create or replace function public.convert_lead_to_deal(
  p_lead_id bigint,
  p_deal_name text default null,
  p_amount numeric default null,
  p_company_name text default null,
  p_company_domain text default null
)
returns table (
  contact_id uuid,
  contact_public_id text,
  company_id uuid,
  company_public_id text,
  deal_id uuid,
  deal_public_id text,
  already_converted boolean
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  l public.leads%rowtype;
  c public.contacts%rowtype;
  co public.companies%rowtype;
  d public.deals%rowtype;
  pipeline_uuid uuid;
  stage_uuid uuid;
  derived_amount numeric := 0;
  clean_budget text;
begin
  select * into l from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;
  if not private.is_workspace_member(l.workspace_id) then raise exception 'Workspace access denied'; end if;

  if l.converted_deal_id is not null then
    select * into d from public.deals where id = l.converted_deal_id;
    if l.converted_contact_id is not null then select * into c from public.contacts where id = l.converted_contact_id; end if;
    if l.converted_company_id is not null then select * into co from public.companies where id = l.converted_company_id; end if;
    return query select c.id, c.public_id, co.id, co.public_id, d.id, d.public_id, true;
    return;
  end if;

  if l.email is not null then
    select * into c from public.contacts where workspace_id = l.workspace_id and lower(email) = lower(l.email) order by created_at asc limit 1;
  end if;

  if c.id is null then
    insert into public.contacts(workspace_id, display_name, email, lifecycle_stage)
    values (l.workspace_id, coalesce(nullif(btrim(l.name), ''), l.email, 'Converted lead'), l.email, 'prospect')
    returning * into c;
  end if;

  if nullif(btrim(coalesce(p_company_name,'')), '') is not null or nullif(btrim(coalesce(p_company_domain,'')), '') is not null then
    if nullif(btrim(coalesce(p_company_domain,'')), '') is not null then
      select * into co from public.companies where workspace_id = l.workspace_id and lower(domain) = lower(btrim(p_company_domain)) limit 1;
    end if;
    if co.id is null and nullif(btrim(coalesce(p_company_name,'')), '') is not null then
      select * into co from public.companies where workspace_id = l.workspace_id and lower(name) = lower(btrim(p_company_name)) limit 1;
    end if;
    if co.id is null then
      insert into public.companies(workspace_id, name, domain)
      values (l.workspace_id, coalesce(nullif(btrim(p_company_name), ''), btrim(p_company_domain)), nullif(btrim(p_company_domain), ''))
      returning * into co;
    end if;
    update public.contacts set company_id = co.id where id = c.id and company_id is null;
  end if;

  select id into pipeline_uuid from public.pipelines where workspace_id = l.workspace_id and is_default = true order by created_at asc limit 1;
  if pipeline_uuid is null then raise exception 'No default pipeline is configured'; end if;
  select id into stage_uuid from public.pipeline_stages where pipeline_id = pipeline_uuid and stage_type = 'open' order by position asc limit 1;
  if stage_uuid is null then raise exception 'No open stage exists in the default pipeline'; end if;

  if p_amount is null then
    clean_budget := regexp_replace(coalesce(l.budget,''), '[^0-9.]', '', 'g');
    if clean_budget ~ '^[0-9]+(\.[0-9]+)?$' then derived_amount := clean_budget::numeric; end if;
  else
    derived_amount := greatest(p_amount, 0);
  end if;

  insert into public.deals(
    workspace_id, pipeline_id, pipeline_stage_id, primary_contact_id, company_id, origin_lead_id, name, amount, currency_code
  ) values (
    l.workspace_id, pipeline_uuid, stage_uuid, c.id, co.id, l.id,
    coalesce(nullif(btrim(p_deal_name), ''), coalesce(nullif(btrim(l.name), ''), 'Lead') || ' Opportunity'),
    coalesce(derived_amount, 0), 'USD'
  ) returning * into d;

  update public.leads
  set converted_contact_id = c.id,
      converted_company_id = co.id,
      converted_deal_id = d.id,
      converted_at = now()
  where id = l.id;

  insert into public.crm_activities(workspace_id, record_type, record_id, activity_type, title, metadata, actor_user_id)
  values (
    l.workspace_id, 'lead', l.public_id, 'lead_converted', 'Lead converted to deal',
    jsonb_build_object('contact_public_id', c.public_id, 'company_public_id', co.public_id, 'deal_public_id', d.public_id), auth.uid()
  );

  return query select c.id, c.public_id, co.id, co.public_id, d.id, d.public_id, false;
end;
$$;

revoke all on function public.convert_lead_to_deal(bigint, text, numeric, text, text) from public;
grant execute on function public.convert_lead_to_deal(bigint, text, numeric, text, text) to authenticated;;
