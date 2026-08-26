revoke all on function public.get_weekly_crm_metrics(timestamp with time zone, text) from public, anon, authenticated;
revoke all on function public.save_weekly_summary_v2(text, text, timestamp with time zone, text) from public, anon, authenticated;
grant execute on function public.get_weekly_crm_metrics(timestamp with time zone, text) to service_role;
grant execute on function public.save_weekly_summary_v2(text, text, timestamp with time zone, text) to service_role;;
