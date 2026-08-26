create or replace view public.workspace_ai_snapshot
with (security_invoker = true)
as
select
  w.id as workspace_id,
  w.public_id as workspace_public_id,
  w.name as workspace_name,
  coalesce(l.total_leads, 0) as active_leads,
  coalesce(l.hot_leads, 0) as hot_leads,
  coalesce(l.warm_leads, 0) as warm_leads,
  coalesce(l.cold_leads, 0) as cold_leads,
  coalesce(l.lead_budget_value_usd, 0)::numeric(18,2) as lead_budget_value_usd,
  coalesce(d.open_deals, 0) as open_deals,
  coalesce(d.open_pipeline_value_usd, 0)::numeric(18,2) as open_pipeline_value_usd,
  coalesce(d.won_deals, 0) as won_deals,
  coalesce(d.won_value_usd, 0)::numeric(18,2) as won_value_usd,
  coalesce(d.lost_deals, 0) as lost_deals,
  coalesce(d.stale_open_deals, 0) as stale_open_deals,
  coalesce(t.open_tasks, 0) as open_tasks,
  coalesce(t.overdue_tasks, 0) as overdue_tasks,
  coalesce(t.due_today_tasks, 0) as due_today_tasks,
  coalesce(c.contacts_count, 0) as contacts_count,
  coalesce(co.companies_count, 0) as companies_count,
  a.latest_activity_at
from public.workspaces w
left join lateral (
  select
    count(*) as total_leads,
    count(*) filter (where lower(coalesce(le.routing_status, le.category, '')) = 'hot') as hot_leads,
    count(*) filter (where lower(coalesce(le.routing_status, le.category, '')) = 'warm') as warm_leads,
    count(*) filter (where lower(coalesce(le.routing_status, le.category, '')) = 'cold') as cold_leads,
    sum(case when le.currency_code = 'USD' then coalesce(nullif(regexp_replace(coalesce(le.budget,''), '[^0-9.]', '', 'g'), '')::numeric, 0) else 0 end) as lead_budget_value_usd
  from public.leads le
  where le.workspace_id = w.id and le.archived_at is null
) l on true
left join lateral (
  select
    count(*) filter (where de.status = 'open') as open_deals,
    sum(de.amount) filter (where de.status = 'open' and de.currency_code = 'USD') as open_pipeline_value_usd,
    count(*) filter (where de.status = 'won') as won_deals,
    sum(de.amount) filter (where de.status = 'won' and de.currency_code = 'USD') as won_value_usd,
    count(*) filter (where de.status = 'lost') as lost_deals,
    count(*) filter (where de.status = 'open' and de.updated_at < now() - interval '14 days') as stale_open_deals
  from public.deals de
  where de.workspace_id = w.id
) d on true
left join lateral (
  select
    count(*) filter (where lt.status = 'open') as open_tasks,
    count(*) filter (where lt.status = 'open' and lt.due_at < date_trunc('day', now())) as overdue_tasks,
    count(*) filter (where lt.status = 'open' and lt.due_at >= date_trunc('day', now()) and lt.due_at < date_trunc('day', now()) + interval '1 day') as due_today_tasks
  from public.lead_tasks lt
  where lt.workspace_id = w.id
) t on true
left join lateral (select count(*) as contacts_count from public.contacts ct where ct.workspace_id = w.id) c on true
left join lateral (select count(*) as companies_count from public.companies cp where cp.workspace_id = w.id) co on true
left join lateral (select max(ca.occurred_at) as latest_activity_at from public.crm_activities ca where ca.workspace_id = w.id) a on true;

create or replace view public.lead_ai_context
with (security_invoker = true)
as
select
  l.workspace_id,
  l.id as lead_id,
  l.public_id as lead_public_id,
  l.name,
  l.email,
  l.message,
  l.budget,
  l.currency_code,
  l.category as ai_category,
  l.intent as ai_intent,
  l.summary as ai_summary,
  l.routing_status,
  l.source,
  l.created_at,
  ps.name as pipeline_stage,
  ps.stage_type as pipeline_stage_type,
  coalesce(tasks.open_tasks, 0) as open_tasks,
  coalesce(tasks.overdue_tasks, 0) as overdue_tasks,
  tasks.next_due_at,
  notes.recent_notes,
  l.converted_at,
  c.public_id as converted_contact_public_id,
  co.public_id as converted_company_public_id,
  d.public_id as converted_deal_public_id
from public.leads l
left join public.pipeline_stages ps on ps.id = l.pipeline_stage_id
left join lateral (
  select
    count(*) filter (where t.status = 'open') as open_tasks,
    count(*) filter (where t.status = 'open' and t.due_at < now()) as overdue_tasks,
    min(t.due_at) filter (where t.status = 'open') as next_due_at
  from public.lead_tasks t
  where t.lead_id = l.id
) tasks on true
left join lateral (
  select jsonb_agg(jsonb_build_object('body', n.body, 'created_at', n.created_at) order by n.created_at desc) as recent_notes
  from (select body, created_at from public.lead_notes where lead_id = l.id order by created_at desc limit 5) n
) notes on true
left join public.contacts c on c.id = l.converted_contact_id
left join public.companies co on co.id = l.converted_company_id
left join public.deals d on d.id = l.converted_deal_id
where l.archived_at is null;;
