import { createClient } from '@supabase/supabase-js'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const supabaseUrl = required('VITE_SUPABASE_URL')
const supabaseAnonKey = required('VITE_SUPABASE_ANON_KEY')
const email = required('E2E_PRIMARY_EMAIL')
const password = required('E2E_PRIMARY_PASSWORD')
const expectedAfterRaw = required('FOLLOW_UP_EXPECTED_AFTER')
const expectedWorkspaceId = process.env.FOLLOW_UP_EXPECTED_WORKSPACE_ID?.trim() || null
const expectedRunRef = process.env.FOLLOW_UP_EXPECTED_RUN_REF?.trim() || null
const maxAgeMinutes = Number(process.env.FOLLOW_UP_MAX_AGE_MINUTES || '90')

const expectedAfter = new Date(expectedAfterRaw)
assert(Number.isFinite(expectedAfter.getTime()), 'FOLLOW_UP_EXPECTED_AFTER must be a valid ISO timestamp')
assert(Number.isFinite(maxAgeMinutes) && maxAgeMinutes > 0, 'FOLLOW_UP_MAX_AGE_MINUTES must be a positive number')

const client = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
})

const signIn = await client.auth.signInWithPassword({ email, password })
assert(!signIn.error, `Configured QA sign-in failed: ${signIn.error?.message || 'unknown error'}`)
assert(signIn.data.user, 'Configured QA sign-in returned no user')

const membership = await client
  .from('workspace_members')
  .select('workspace_id')
  .eq('user_id', signIn.data.user.id)

assert(!membership.error, `Could not resolve QA workspace: ${membership.error?.message || 'unknown error'}`)
assert(membership.data?.length === 1, 'Configured QA identity must resolve exactly one visible workspace')

const workspaceId = membership.data[0].workspace_id
if (expectedWorkspaceId) {
  assert(workspaceId === expectedWorkspaceId, `QA identity resolved workspace ${workspaceId}, expected ${expectedWorkspaceId}`)
}

const runs = await client
  .from('automation_runs')
  .select('id,workspace_id,automation_key,automation_name,source,trigger_type,status,run_ref,started_at,finished_at,error_code,error_message,metadata')
  .eq('automation_key', 'follow-up-engine')
  .gte('started_at', expectedAfter.toISOString())
  .order('started_at', { ascending: false })
  .limit(20)

assert(!runs.error, `Could not read Follow-Up telemetry: ${runs.error?.message || 'unknown error'}`)
assert((runs.data || []).length > 0, `No Follow-Up telemetry found at or after ${expectedAfter.toISOString()}`)

const latest = runs.data[0]
assert(latest.workspace_id === workspaceId, `Latest Follow-Up telemetry belongs to unexpected workspace ${latest.workspace_id}`)
assert(latest.source === 'n8n', `Expected source=n8n, got ${latest.source}`)
assert(latest.trigger_type === 'scheduled', `Expected trigger_type=scheduled, got ${latest.trigger_type}`)
assert(latest.status === 'suppressed', `Expected status=suppressed while writes are disabled, got ${latest.status}`)
assert(Boolean(latest.run_ref), 'Expected a populated n8n run_ref')
if (expectedRunRef) assert(latest.run_ref === expectedRunRef, `Expected run_ref=${expectedRunRef}, got ${latest.run_ref}`)

const lastAtRaw = latest.finished_at || latest.started_at
const lastAt = new Date(lastAtRaw)
assert(Number.isFinite(lastAt.getTime()), 'Latest Follow-Up telemetry has an invalid timestamp')
const ageMinutes = (Date.now() - lastAt.getTime()) / 60000
assert(ageMinutes >= 0 && ageMinutes <= maxAgeMinutes, `Latest Follow-Up heartbeat is ${ageMinutes.toFixed(1)} minutes old; expected <= ${maxAgeMinutes}`)

for (const run of runs.data || []) {
  assert(run.workspace_id === workspaceId, `Authenticated telemetry read leaked foreign workspace ${run.workspace_id}`)
  const inspectable = JSON.stringify({
    metadata: run.metadata || {},
    error_code: run.error_code,
    error_message: run.error_message,
  })
  assert(!/authorization|bearer\s|api[_-]?key|access[_-]?token|secret/i.test(inspectable), `Secret-like telemetry detected in run ${run.id}`)
}

console.log(JSON.stringify({
  ok: true,
  workspace_id: workspaceId,
  automation_key: latest.automation_key,
  status: latest.status,
  source: latest.source,
  trigger_type: latest.trigger_type,
  run_ref: latest.run_ref,
  started_at: latest.started_at,
  finished_at: latest.finished_at,
  rows_since_expected_after: runs.data.length,
}, null, 2))
