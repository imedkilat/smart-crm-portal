import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const REQUIRED_CONFIRMATION = 'SMART_CRM_SYNTHETIC_QA_ONLY'
const QA_WORKSPACE_NAME = 'Smart CRM Starter QA'
const QA_LEAD_EMAIL = 'followup.qa.lead@qatest.example.com'
const QA_QUOTE_REFERENCE = 'QA-QUOTE-001'
const QA_OUTBOUND_IDEMPOTENCY_KEY = 'qa-outbound-sim-20260901-001'

const requiredEnv = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'E2E_PRIMARY_EMAIL',
  'E2E_PRIMARY_PASSWORD',
  'E2E_SECONDARY_EMAIL',
  'E2E_SECONDARY_PASSWORD',
]

for (const name of requiredEnv) {
  assert.ok(process.env[name]?.trim(), `Missing required environment variable: ${name}`)
}

assert.equal(
  process.env.CONTROLLED_REGRESSION_CONFIRMATION,
  REQUIRED_CONFIRMATION,
  `Refusing controlled regression without confirmation phrase ${REQUIRED_CONFIRMATION}`,
)

const supabaseUrl = process.env.VITE_SUPABASE_URL.trim()
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY.trim()

function client() {
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}

async function requireData(result, label) {
  assert.equal(result.error, null, `${label}: ${result.error?.message || 'query failed'}`)
  return result.data
}

async function signIn(email, password) {
  const supabase = client()
  const auth = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  assert.equal(auth.error, null, `Configured QA identity could not sign in: ${email}`)
  assert.ok(auth.data.user, `Configured QA identity has no user after sign-in: ${email}`)

  const memberships = await requireData(
    await supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', auth.data.user.id),
    `workspace membership lookup for ${email}`,
  )

  assert.equal(memberships.length, 1, `QA identity ${email} must have exactly one visible workspace`)

  const workspaceId = memberships[0].workspace_id
  const workspaces = await requireData(
    await supabase.from('workspaces').select('id, name').eq('id', workspaceId),
    `workspace lookup for ${email}`,
  )

  assert.deepEqual(workspaces.map(({ id }) => id), [workspaceId])
  return {
    supabase,
    email,
    userId: auth.data.user.id,
    workspaceId,
    workspaceName: workspaces[0].name,
    role: memberships[0].role,
  }
}

const primary = await signIn(process.env.E2E_PRIMARY_EMAIL, process.env.E2E_PRIMARY_PASSWORD)
const secondary = await signIn(process.env.E2E_SECONDARY_EMAIL, process.env.E2E_SECONDARY_PASSWORD)

assert.notEqual(primary.userId, secondary.userId, 'Controlled regression identities must be distinct users')
assert.notEqual(primary.workspaceId, secondary.workspaceId, 'Controlled regression identities must be in distinct workspaces')

const qaSessions = [primary, secondary].filter((session) => session.workspaceName === QA_WORKSPACE_NAME)
assert.equal(qaSessions.length, 1, `Exactly one configured QA identity must own ${QA_WORKSPACE_NAME}`)
const qa = qaSessions[0]

const followUpRows = await requireData(
  await qa.supabase
    .from('workspace_follow_up_settings')
    .select('enabled, timezone, hot_stale_hours, warm_stale_hours, max_tasks_per_run, max_tasks_per_day, paused_until')
    .eq('workspace_id', qa.workspaceId),
  'Follow-Up settings preflight',
)
assert.equal(followUpRows.length, 1)
assert.equal(followUpRows[0].enabled, true, 'Starter QA Follow-Up Engine must be enabled for the production canary baseline')
assert.equal(followUpRows[0].max_tasks_per_run, 1, 'Starter QA Follow-Up Engine must stay capped at one task per run')
assert.equal(followUpRows[0].paused_until, null, 'Starter QA Follow-Up Engine must not be paused for the baseline')

const outboundRows = await requireData(
  await qa.supabase
    .from('workspace_outbound_email_settings')
    .select('enabled, mode, provider, max_emails_per_run, paused_until')
    .eq('workspace_id', qa.workspaceId),
  'outbound settings preflight',
)
assert.equal(outboundRows.length, 1)
assert.equal(outboundRows[0].enabled, false, 'Outbound email must remain disabled before controlled write testing')
assert.equal(outboundRows[0].mode, 'disabled', 'Outbound email mode must remain disabled before controlled write testing')
assert.equal(outboundRows[0].provider, null, 'No live outbound provider should be configured for the controlled preflight')
assert.equal(outboundRows[0].max_emails_per_run, 1, 'Outbound run cap must remain one')

const quoteAlertRows = await requireData(
  await qa.supabase
    .from('workspace_quote_alert_settings')
    .select('enabled, channel, destination_ref, paused_until')
    .eq('workspace_id', qa.workspaceId),
  'quote-alert settings preflight',
)
assert.equal(quoteAlertRows.length, 1)
assert.equal(quoteAlertRows[0].enabled, false, 'Quote alerts must remain disabled during controlled regression')

const leads = await requireData(
  await qa.supabase
    .from('leads')
    .select('id, public_id, name, email, routing_status, archived_at')
    .eq('workspace_id', qa.workspaceId)
    .eq('email', QA_LEAD_EMAIL),
  'synthetic QA lead lookup',
)
assert.equal(leads.length, 1, `Expected exactly one synthetic lead ${QA_LEAD_EMAIL}`)
const lead = leads[0]
assert.equal(lead.routing_status, 'Hot')
assert.equal(lead.archived_at, null)
assert.ok(String(lead.public_id).startsWith('ld_'))

const tasks = await requireData(
  await qa.supabase
    .from('lead_tasks')
    .select('public_id, lead_id, title, description, status, automation_key, created_at')
    .eq('workspace_id', qa.workspaceId)
    .eq('lead_id', lead.id),
  'Follow-Up task baseline',
)
const automatedTasks = tasks.filter((task) => String(task.automation_key || '').startsWith('follow-up:'))
assert.equal(automatedTasks.length, 1, 'Synthetic QA lead must have exactly one automated Follow-Up task baseline')
assert.ok(String(automatedTasks[0].automation_key).includes(lead.public_id), 'Follow-Up automation key must be scoped to the synthetic lead public id')
assert.ok(String(automatedTasks[0].description || '').includes('[AUTO-FOLLOW-UP:v1:'), 'Follow-Up task must retain its deterministic v1 marker')

const taskActivities = await requireData(
  await qa.supabase
    .from('lead_activities')
    .select('activity_type, title, metadata, occurred_at')
    .eq('workspace_id', qa.workspaceId)
    .eq('lead_id', lead.id)
    .eq('activity_type', 'task_created'),
  'Follow-Up activity baseline',
)
assert.equal(taskActivities.length, 1, 'Synthetic QA lead must have exactly one Follow-Up task_created activity baseline')
assert.equal(taskActivities[0].metadata?.task_id, automatedTasks[0].public_id, 'Follow-Up activity must reference the baseline automated task')

const quotes = await requireData(
  await qa.supabase
    .from('lead_quotes')
    .select('id, public_id, lead_id, quote_reference, amount, currency_code, status, sent_at, next_follow_up_at')
    .eq('workspace_id', qa.workspaceId)
    .eq('lead_id', lead.id)
    .eq('quote_reference', QA_QUOTE_REFERENCE),
  'quote lifecycle baseline',
)
assert.equal(quotes.length, 1, `Expected exactly one controlled quote ${QA_QUOTE_REFERENCE}`)
const quote = quotes[0]
assert.equal(Number(quote.amount), 4200)
assert.equal(quote.currency_code, 'USD')
assert.equal(quote.status, 'sent')
assert.ok(quote.sent_at, 'Controlled quote must retain sent_at')
assert.ok(quote.next_follow_up_at, 'Controlled quote must retain next_follow_up_at')

const quoteActivities = await requireData(
  await qa.supabase
    .from('lead_activities')
    .select('activity_type, metadata, occurred_at')
    .eq('workspace_id', qa.workspaceId)
    .eq('lead_id', lead.id)
    .in('activity_type', ['quote_created', 'quote_updated']),
  'quote lifecycle activity baseline',
)
assert.equal(quoteActivities.length, 2, 'Controlled quote must have exactly one create and one update activity baseline')
assert.deepEqual(
  [...quoteActivities.map((activity) => activity.activity_type)].sort(),
  ['quote_created', 'quote_updated'],
)
for (const activity of quoteActivities) {
  assert.equal(activity.metadata?.quote_public_id, quote.public_id, 'Quote activity must stay scoped to the controlled quote')
}

const deliveries = await requireData(
  await qa.supabase
    .from('outbound_email_deliveries')
    .select('id, public_id, lead_id, template_key, idempotency_key, mode, provider, status, attempt_count, provider_message_id, metadata')
    .eq('workspace_id', qa.workspaceId)
    .eq('idempotency_key', QA_OUTBOUND_IDEMPOTENCY_KEY),
  'outbound simulation baseline',
)
assert.equal(deliveries.length, 1, 'Expected exactly one logical outbound simulation baseline')
const delivery = deliveries[0]
assert.equal(delivery.lead_id, lead.id)
assert.equal(delivery.template_key, 'hot-follow-up')
assert.equal(delivery.mode, 'simulate')
assert.equal(delivery.provider, 'simulation')
assert.equal(delivery.status, 'simulated')
assert.equal(delivery.attempt_count, 1)
assert.equal(delivery.provider_message_id, null)
assert.equal(delivery.metadata?.network_call_performed, false)

const attempts = await requireData(
  await qa.supabase
    .from('outbound_email_attempts')
    .select('delivery_id, attempt_number, mode, provider, status, provider_message_id, response_metadata, attempted_at')
    .eq('workspace_id', qa.workspaceId)
    .eq('delivery_id', delivery.id),
  'outbound simulation attempt baseline',
)
assert.equal(attempts.length, 1, 'Logical outbound simulation baseline must have exactly one attempt')
assert.equal(attempts[0].attempt_number, 1)
assert.equal(attempts[0].mode, 'simulate')
assert.equal(attempts[0].provider, 'simulation')
assert.equal(attempts[0].status, 'simulated')
assert.equal(attempts[0].provider_message_id, null)
assert.equal(attempts[0].response_metadata?.network_call_performed, false)

console.log('Controlled automation preflight PASS')
console.log(`Workspace: ${qa.workspaceName}`)
console.log(`Synthetic lead: ${lead.public_id}`)
console.log(`Follow-Up task: ${automatedTasks[0].public_id}`)
console.log(`Quote: ${quote.public_id}`)
console.log(`Outbound delivery: ${delivery.public_id}`)
console.log('No insert, update, delete, provider, or outbound network call was performed by this preflight.')
