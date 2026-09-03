import fs from 'node:fs'

const migrationPath = 'supabase/migrations/20260903043000_add_ai_call_readiness_foundation.sql'
const sql = fs.readFileSync(migrationPath, 'utf8')

const required = [
  'add column phone_e164 text',
  'add column owner_user_id uuid',
  "phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'",
  'guard_lead_owner_workspace_membership',
  'Lead owner must be a member of the same workspace',
  'trg_clear_lead_owner_on_member_removal',
  'after delete or update of workspace_id, user_id on public.workspace_members',
  'create table public.workspace_member_call_profiles',
  'foreign key (workspace_id, user_id)',
  'references public.workspace_members(workspace_id, user_id)',
  'accepts_warm_transfers boolean not null default false',
  'alter table public.workspace_member_call_profiles enable row level security',
  'revoke all on table public.workspace_member_call_profiles from public',
  'revoke all on table public.workspace_member_call_profiles from anon',
  'workspace_member_call_profiles_select',
  'workspace_member_call_profiles_insert',
  'workspace_member_call_profiles_update',
  'workspace_member_call_profiles_delete',
  'create or replace function public.list_workspace_member_directory',
  'call_ready boolean',
  "grant execute on function public.list_workspace_member_directory(uuid) to authenticated",
]

for (const marker of required) {
  if (!sql.includes(marker)) {
    throw new Error(`AI call readiness foundation is missing required marker: ${marker}`)
  }
}

const forbidden = [
  'api.retellai.com',
  'RETELL_API_KEY',
  'create_phone_call',
  'outbound_call_enabled',
]

for (const marker of forbidden) {
  if (sql.includes(marker)) {
    throw new Error(`Foundation migration must not enable provider/live calling behavior: ${marker}`)
  }
}

const functionStart = sql.indexOf('create or replace function public.list_workspace_member_directory')
const functionSql = functionStart >= 0 ? sql.slice(functionStart) : ''
const returnSignature = functionSql.slice(0, functionSql.indexOf('language plpgsql'))
if (returnSignature.includes('warm_transfer_phone_e164')) {
  throw new Error('Member directory must never return the private warm-transfer phone number')
}

if (/grant\s+execute\s+on\s+function\s+public\.list_workspace_member_directory\(uuid\)\s+to\s+(?:public|anon)/i.test(sql)) {
  throw new Error('Member directory must never be executable by public or anon')
}

console.log('AI Call Qualifier call-readiness foundation source checks passed.')
