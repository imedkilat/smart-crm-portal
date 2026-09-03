import fs from 'node:fs';
import assert from 'node:assert/strict';

const outcomePath = 'supabase/migrations/20260904012000_add_ai_call_outcome_logging.sql';
const guardPath = 'supabase/migrations/20260904011500_allow_ai_call_callback_task_prefix.sql';
const sql = fs.readFileSync(outcomePath, 'utf8');
const guardSql = fs.readFileSync(guardPath, 'utf8');

const required = [
  'create table if not exists public.ai_call_event_receipts',
  'unique (workspace_id, idempotency_key)',
  'alter table public.ai_call_event_receipts enable row level security',
  'revoke all on table public.ai_call_event_receipts from public, anon, authenticated',
  'grant select, insert, update, delete on table public.ai_call_event_receipts to service_role',
  'create or replace function public.record_ai_call_outcome',
  "'ai_call.qualified'",
  "'ai_call.not_qualified'",
  "'ai_call.no_answer'",
  "'ai_call.transferred'",
  "'ai_call.transfer_failed'",
  "jsonb_typeof(p_metadata) <> 'object'",
  "'AI call idempotency key already belongs to a different lead/event'",
  "'source', 'ai_call_qualifier'",
  "'ai-call-callback:' || trim(p_provider_call_id)",
  "'Call back qualified lead'",
  "'high'",
  'insert into public.crm_activities',
  'insert into public.lead_activities',
  'insert into public.lead_tasks',
  'from public, anon, authenticated',
  'to service_role'
];

for (const fragment of required) {
  assert.ok(sql.includes(fragment), `missing required SQL fragment: ${fragment}`);
}

assert.ok(
  sql.includes("where l.workspace_id = p_workspace_id\n    and l.id = p_lead_id"),
  'lead lookup must be workspace scoped'
);

assert.ok(
  sql.includes('on conflict (workspace_id, idempotency_key) do nothing'),
  'event receipt must be concurrency-safe and idempotent'
);

assert.ok(
  sql.includes('v_existing_lead_id is distinct from p_lead_id') &&
    sql.includes('v_existing_activity_type is distinct from p_activity_type'),
  'duplicate event keys must not be reusable for a different lead or activity type'
);

assert.ok(
  sql.includes('on conflict (workspace_id, automation_key)') &&
    sql.includes('where automation_key is not null'),
  'callback task must reuse the existing workspace automation-key uniqueness boundary'
);

const guardRequired = [
  'create or replace function private.guard_follow_up_task_insert()',
  "v_is_production := new.automation_key like 'follow-up:v1:%'",
  "v_is_qa := new.automation_key like 'follow-up:qa:v1:%'",
  "v_is_ai_call_callback := new.automation_key like 'ai-call-callback:%'",
  "new.title is distinct from 'Call back qualified lead'",
  "new.status is distinct from 'open'",
  "new.priority is distinct from 'high'",
  'new.assigned_to is null',
  "coalesce(v_subscription_status, '') not in ('trialing', 'active')",
  "coalesce(v_plan_code, '') not in ('starter', 'pro', 'white_label')",
  "t.automation_key like 'follow-up:v1:%'",
  'v_today_count >= v_max_tasks_per_day'
];

for (const fragment of guardRequired) {
  assert.ok(guardSql.includes(fragment), `missing callback/follow-up guard fragment: ${fragment}`);
}

const forbidden = [
  'api.retellai.com',
  'RETELL_API_KEY',
  'sk_live_',
  'stripe',
  'write_enabled = true',
  'write_enabled=true'
];

for (const fragment of forbidden) {
  assert.ok(!sql.includes(fragment), `forbidden live/provider fragment found in outcome migration: ${fragment}`);
  assert.ok(!guardSql.includes(fragment), `forbidden live/provider fragment found in guard migration: ${fragment}`);
}

console.log('AI Call outcome logging source verification: PASS');
