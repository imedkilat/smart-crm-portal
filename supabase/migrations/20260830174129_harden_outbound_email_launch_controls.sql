-- Keep customer-facing outbound activation server-owned.
-- Workspace owners/admins may tune pause/caps, but cannot enable live delivery,
-- choose the provider, or switch dispatch mode directly through the browser.

revoke update on table public.workspace_outbound_email_settings from authenticated;

grant update (
  max_emails_per_run,
  max_emails_per_day,
  paused_until
) on table public.workspace_outbound_email_settings to authenticated;

comment on column public.workspace_outbound_email_settings.enabled is
  'Server-owned launch gate. Browser clients may read but cannot enable outbound customer email.';
comment on column public.workspace_outbound_email_settings.mode is
  'Server-owned mode gate: disabled, simulate, or live. Live activation requires an explicit controlled rollout.';
comment on column public.workspace_outbound_email_settings.provider is
  'Server-owned non-secret provider adapter name. Provider credentials remain Edge Function secrets.';
