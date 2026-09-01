-- Tighten Automation Health Center ledger permissions.
-- Authenticated users should have SELECT only; all mutation and table-maintenance privileges stay server-side.

revoke all on public.automation_runs from authenticated;
grant select on public.automation_runs to authenticated;
