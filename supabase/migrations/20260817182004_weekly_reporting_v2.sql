alter table public.weekly_summary
  add column if not exists report_version smallint not null default 1,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists previous_period_start date,
  add column if not exists previous_period_end date,
  add column if not exists new_leads integer,
  add column if not exists new_hot_leads integer,
  add column if not exists new_warm_leads integer,
  add column if not exists new_cold_leads integer,
  add column if not exists previous_new_leads integer,
  add column if not exists previous_hot_leads integer,
  add column if not exists previous_warm_leads integer,
  add column if not exists previous_cold_leads integer,
  add column if not exists new_leads_change integer,
  add column if not exists hot_change integer,
  add column if not exists warm_change integer,
  add column if not exists cold_change integer,
  add column if not exists hot_percent numeric(5,2),
  add column if not exists warm_percent numeric(5,2),
  add column if not exists cold_percent numeric(5,2),
  add column if not exists summary_model text,
  add column if not exists generation_source text not null default 'legacy',
  add column if not exists data_timezone text not null default 'Asia/Manila';

update public.weekly_summary
set generation_source = 'legacy_n8n_google_sheets'
where report_version = 1 and generation_source = 'legacy';

create unique index if not exists weekly_summary_v2_period_start_uidx
  on public.weekly_summary (period_start)
  where report_version = 2 and period_start is not null;

create or replace function public.get_weekly_crm_metrics(
  p_reference timestamptz default now(),
  p_timezone text default 'Asia/Manila'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  local_reference timestamp;
  current_week_start date;
  report_start date;
  report_end_exclusive date;
  previous_start date;
  active_total integer;
  active_hot integer;
  active_warm integer;
  active_cold integer;
  report_total integer;
  report_hot integer;
  report_warm integer;
  report_cold integer;
  previous_total integer;
  previous_hot integer;
  previous_warm integer;
  previous_cold integer;
  report_label text;
  previous_label text;
begin
  local_reference := p_reference at time zone p_timezone;
  current_week_start := date_trunc('week', local_reference)::date;
  report_start := current_week_start - 7;
  report_end_exclusive := current_week_start;
  previous_start := report_start - 7;

  select
    count(*)::integer,
    count(*) filter (where lower(coalesce(routing_status, category, '')) = 'hot')::integer,
    count(*) filter (where lower(coalesce(routing_status, category, '')) = 'warm')::integer,
    count(*) filter (where lower(coalesce(routing_status, category, '')) = 'cold')::integer
  into active_total, active_hot, active_warm, active_cold
  from public.leads
  where archived_at is null;

  select
    count(*)::integer,
    count(*) filter (where lower(coalesce(category, '')) = 'hot')::integer,
    count(*) filter (where lower(coalesce(category, '')) = 'warm')::integer,
    count(*) filter (where lower(coalesce(category, '')) = 'cold')::integer
  into report_total, report_hot, report_warm, report_cold
  from public.leads
  where archived_at is null
    and (created_at at time zone p_timezone)::date >= report_start
    and (created_at at time zone p_timezone)::date < report_end_exclusive;

  select
    count(*)::integer,
    count(*) filter (where lower(coalesce(category, '')) = 'hot')::integer,
    count(*) filter (where lower(coalesce(category, '')) = 'warm')::integer,
    count(*) filter (where lower(coalesce(category, '')) = 'cold')::integer
  into previous_total, previous_hot, previous_warm, previous_cold
  from public.leads
  where archived_at is null
    and (created_at at time zone p_timezone)::date >= previous_start
    and (created_at at time zone p_timezone)::date < report_start;

  report_label := to_char(report_start, 'Mon FMDD') || ' – ' || to_char(report_end_exclusive - 1, 'Mon FMDD, YYYY');
  previous_label := to_char(previous_start, 'Mon FMDD') || ' – ' || to_char(report_start - 1, 'Mon FMDD, YYYY');

  return jsonb_build_object(
    'period', report_label,
    'period_start', report_start,
    'period_end', report_end_exclusive - 1,
    'previous_period', previous_label,
    'previous_period_start', previous_start,
    'previous_period_end', report_start - 1,
    'timezone', p_timezone,
    'generated_at', now(),
    'active_pipeline', jsonb_build_object(
      'total', active_total,
      'hot', active_hot,
      'warm', active_warm,
      'cold', active_cold
    ),
    'new_leads', jsonb_build_object(
      'total', report_total,
      'hot', report_hot,
      'warm', report_warm,
      'cold', report_cold,
      'hot_percent', case when report_total > 0 then round((report_hot::numeric / report_total) * 100, 2) else 0 end,
      'warm_percent', case when report_total > 0 then round((report_warm::numeric / report_total) * 100, 2) else 0 end,
      'cold_percent', case when report_total > 0 then round((report_cold::numeric / report_total) * 100, 2) else 0 end
    ),
    'previous_new_leads', jsonb_build_object(
      'total', previous_total,
      'hot', previous_hot,
      'warm', previous_warm,
      'cold', previous_cold
    ),
    'changes', jsonb_build_object(
      'total', report_total - previous_total,
      'hot', report_hot - previous_hot,
      'warm', report_warm - previous_warm,
      'cold', report_cold - previous_cold
    )
  );
end;
$$;

create or replace function public.save_weekly_summary_v2(
  p_ai_summary text,
  p_summary_model text default 'Google Gemini',
  p_reference timestamptz default now(),
  p_timezone text default 'Asia/Manila'
)
returns public.weekly_summary
language plpgsql
security definer
set search_path = public
as $$
declare
  metrics jsonb;
  saved public.weekly_summary;
begin
  metrics := public.get_weekly_crm_metrics(p_reference, p_timezone);

  insert into public.weekly_summary (
    period,
    total_leads,
    hot_leads,
    warm_leads,
    cold_leads,
    ai_summary,
    report_version,
    period_start,
    period_end,
    previous_period_start,
    previous_period_end,
    new_leads,
    new_hot_leads,
    new_warm_leads,
    new_cold_leads,
    previous_new_leads,
    previous_hot_leads,
    previous_warm_leads,
    previous_cold_leads,
    new_leads_change,
    hot_change,
    warm_change,
    cold_change,
    hot_percent,
    warm_percent,
    cold_percent,
    summary_model,
    generation_source,
    data_timezone,
    created_at
  ) values (
    metrics->>'period',
    (metrics#>>'{active_pipeline,total}')::integer,
    (metrics#>>'{active_pipeline,hot}')::integer,
    (metrics#>>'{active_pipeline,warm}')::integer,
    (metrics#>>'{active_pipeline,cold}')::integer,
    nullif(trim(p_ai_summary), ''),
    2,
    (metrics->>'period_start')::date,
    (metrics->>'period_end')::date,
    (metrics->>'previous_period_start')::date,
    (metrics->>'previous_period_end')::date,
    (metrics#>>'{new_leads,total}')::integer,
    (metrics#>>'{new_leads,hot}')::integer,
    (metrics#>>'{new_leads,warm}')::integer,
    (metrics#>>'{new_leads,cold}')::integer,
    (metrics#>>'{previous_new_leads,total}')::integer,
    (metrics#>>'{previous_new_leads,hot}')::integer,
    (metrics#>>'{previous_new_leads,warm}')::integer,
    (metrics#>>'{previous_new_leads,cold}')::integer,
    (metrics#>>'{changes,total}')::integer,
    (metrics#>>'{changes,hot}')::integer,
    (metrics#>>'{changes,warm}')::integer,
    (metrics#>>'{changes,cold}')::integer,
    (metrics#>>'{new_leads,hot_percent}')::numeric,
    (metrics#>>'{new_leads,warm_percent}')::numeric,
    (metrics#>>'{new_leads,cold_percent}')::numeric,
    p_summary_model,
    'n8n_weekly_summary_v2',
    p_timezone,
    now()
  )
  on conflict (period_start) where report_version = 2 and period_start is not null
  do update set
    period = excluded.period,
    total_leads = excluded.total_leads,
    hot_leads = excluded.hot_leads,
    warm_leads = excluded.warm_leads,
    cold_leads = excluded.cold_leads,
    ai_summary = excluded.ai_summary,
    period_end = excluded.period_end,
    previous_period_start = excluded.previous_period_start,
    previous_period_end = excluded.previous_period_end,
    new_leads = excluded.new_leads,
    new_hot_leads = excluded.new_hot_leads,
    new_warm_leads = excluded.new_warm_leads,
    new_cold_leads = excluded.new_cold_leads,
    previous_new_leads = excluded.previous_new_leads,
    previous_hot_leads = excluded.previous_hot_leads,
    previous_warm_leads = excluded.previous_warm_leads,
    previous_cold_leads = excluded.previous_cold_leads,
    new_leads_change = excluded.new_leads_change,
    hot_change = excluded.hot_change,
    warm_change = excluded.warm_change,
    cold_change = excluded.cold_change,
    hot_percent = excluded.hot_percent,
    warm_percent = excluded.warm_percent,
    cold_percent = excluded.cold_percent,
    summary_model = excluded.summary_model,
    generation_source = excluded.generation_source,
    data_timezone = excluded.data_timezone,
    created_at = now()
  returning * into saved;

  return saved;
end;
$$;

grant execute on function public.get_weekly_crm_metrics(timestamptz, text) to authenticated, service_role;
grant execute on function public.save_weekly_summary_v2(text, text, timestamptz, text) to service_role;;
