-- Preserve the existing controlled Follow-Up Engine QA contract.
-- QA automation keys are allowlisted and intentionally bypass paid-plan checks;
-- only production follow-up task keys are subject to commercial entitlement.

create or replace function private.enforce_follow_up_task_billing_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.automation_key, '') like 'follow-up:v1:%' then
    perform private.assert_workspace_entitlement(
      new.workspace_id,
      'follow_up_automation'
    );
  end if;
  return new;
end;
$$;

comment on function private.enforce_follow_up_task_billing_gate() is
  'Commercial entitlement guard for production Follow-Up Engine tasks only. Controlled follow-up:qa:v1 keys retain the existing QA bypass.';
