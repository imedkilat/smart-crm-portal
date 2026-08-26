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

grant execute on function public.save_weekly_summary_v2(text, text, timestamptz, text) to service_role;;
