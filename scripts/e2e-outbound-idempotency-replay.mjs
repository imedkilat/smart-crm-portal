import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const REQUIRED_CONFIRMATION = 'SMART_CRM_OUTBOUND_DUPLICATE_QA'
const QA_WORKSPACE_NAME = 'Smart CRM Starter QA'
const QA_LEAD_EMAIL = 'followup.qa.lead@qatest.example.com'
const QA_IDEMPOTENCY_KEY = 'qa-outbound-sim-20260901-001'
const QA_TEMPLATE_KEY = 'hot-follow-up'

const requiredEnv = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'E2E_PRIMARY_EMAIL',
  'E2E_PRIMARY_PASSWORD',
  'E2E_SECONDARY_EMAIL',
  'E2E_SECONDARY_PASSWORD',
  'OUTBOUND_EMAIL_INGRESS_TOKEN',
]

for (const name of requiredEnv) {
  assert.ok(process.env[name]?.trim(), `Missing required environment variable: ${name}`)
}

assert.equal(
  process.env.OUTBOUND_IDEMPOTENCY_CONFIRMATION,
  REQUIRED_CONFIRMATION,
  `Refusing outbound duplicate replay without confirmation phrase ${REQUIRED_CONFIRMATION}`,
)

const supabaseUrl = process.env.VITE_SUPABASE_URL.trim().replace(/\/$/, '')
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY.trim()
const ingressToken = process.env.OUTBOUND_EMAIL_INGRESS_TOKEN.trim()

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
  assert.equal(workspaces.length, 1)

  return {
    supabase,
    userId: auth.data.user.id,
    workspaceId,
    workspaceName: workspaces[0].name,
  }
}

const primary = await signIn(process.env.E2E_PRIMARY_EMAIL, process.env.E2E_PRIMARY_PASSWORD)
const secondary = await signIn(process.env.E2E_SECONDARY_EMAIL, process.env.E2E_SECONDARY_PASSWORD)
assert.notEqual(primary.userId, secondary.userId, 'Controlled regression identities must be distinct users')
assert.notEqual(primary.workspaceId, secondary.workspaceId, 'Controlled regression identities must be in distinct workspaces')

const qaSessions = [primary, secondary].filter((session) => session.workspaceName === QA_WORKSPACE_NAME)
assert.equal(qaSessions.length, 1, `Exactly one configured QA identity must own ${QA_WORKSPACE_NAME}`)
const qa = qaSessions[0]

const settings = await requireData(
  await qa.supabase
    .from('workspace_outbound_email_settings')
    .select('enabled, mode, provider, max_emails_per_run, paused_until')
    .eq('workspace_id', qa.workspaceId),
  'outbound settings preflight',
)
assert.equal(settings.length, 1)
assert.equal(settings[0].enabled, false, 'Outbound email must remain disabled for duplicate replay')
assert.equal(settings[0].mode, 'disabled', 'Outbound mode must remain disabled for duplicate replay')
assert.equal(settings[0].provider, null, 'No live provider may be configured for duplicate replay')
assert.equal(settings[0].max_emails_per_run, 1, 'Outbound run cap must remain one')

const leads = await requireData(
  await qa.supabase
    .from('leads')
    .select('id, public_id, email, archived_at')
    .eq('workspace_id', qa.workspaceId)
    .eq('email', QA_LEAD_EMAIL),
  'synthetic lead lookup',
)
assert.equal(leads.length, 1, `Expected exactly one synthetic lead ${QA_LEAD_EMAIL}`)
const lead = leads[0]
assert.equal(lead.archived_at, null)

const deliveriesBefore = await requireData(
  await qa.supabase
    .from('outbound_email_deliveries')
    .select('id, public_id, lead_id, template_key, idempotency_key, mode, provider, status, attempt_count, provider_message_id, metadata')
    .eq('workspace_id', qa.workspaceId),
  'delivery baseline',
)
const fixtureDeliveries = deliveriesBefore.filter((row) => row.idempotency_key === QA_IDEMPOTENCY_KEY)
assert.equal(fixtureDeliveries.length, 1, 'Expected exactly one existing logical outbound fixture')
const fixture = fixtureDeliveries[0]
assert.equal(fixture.lead_id, lead.id)
assert.equal(fixture.template_key, QA_TEMPLATE_KEY)
assert.equal(fixture.mode, 'simulate')
assert.equal(fixture.status, 'simulated')
assert.equal(fixture.attempt_count, 1)
assert.equal(fixture.provider_message_id, null)
assert.equal(fixture.metadata?.network_call_performed, false)

const attemptsBefore = await requireData(
  await qa.supabase
    .from('outbound_email_attempts')
    .select('id, delivery_id, attempt_number, mode, provider, status, provider_message_id, response_metadata')
    .eq('workspace_id', qa.workspaceId),
  'attempt baseline',
)
const fixtureAttemptsBefore = attemptsBefore.filter((row) => row.delivery_id === fixture.id)
assert.equal(fixtureAttemptsBefore.length, 1, 'Existing logical outbound fixture must have exactly one attempt')
assert.equal(fixtureAttemptsBefore[0].attempt_number, 1)
assert.equal(fixtureAttemptsBefore[0].response_metadata?.network_call_performed, false)

const response = await fetch(`${supabaseUrl}/functions/v1/crm-outbound-email`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-smart-crm-outbound-token': ingressToken,
  },
  body: JSON.stringify({
    workspace_id: qa.workspaceId,
    lead_public_id: lead.public_id,
    template_key: QA_TEMPLATE_KEY,
    idempotency_key: QA_IDEMPOTENCY_KEY,
  }),
  signal: AbortSignal.timeout(20_000),
})

const raw = await response.text()
let payload
try {
  payload = raw ? JSON.parse(raw) : {}
} catch {
  assert.fail(`Outbound endpoint returned non-JSON HTTP ${response.status}`)
}

assert.equal(response.status, 200, `Expected duplicate replay HTTP 200, got ${response.status}: ${raw.slice(0, 500)}`)
assert.equal(payload.ok, true)
assert.equal(payload.duplicate, true, 'Existing logical outbound key must take duplicate path')
assert.equal(payload.delivery?.public_id, fixture.public_id, 'Duplicate replay must return the existing logical delivery')
assert.equal(payload.delivery?.attempt_count, 1, 'Duplicate replay must not increment attempt_count')
assert.equal(payload.delivery?.provider_message_id, null, 'Duplicate replay must not gain a provider message id')

const deliveriesAfter = await requireData(
  await qa.supabase
    .from('outbound_email_deliveries')
    .select('id, public_id, idempotency_key, attempt_count, provider_message_id, metadata')
    .eq('workspace_id', qa.workspaceId),
  'delivery post-check',
)
const attemptsAfter = await requireData(
  await qa.supabase
    .from('outbound_email_attempts')
    .select('id, delivery_id, attempt_number, provider_message_id, response_metadata')
    .eq('workspace_id', qa.workspaceId),
  'attempt post-check',
)

assert.equal(deliveriesAfter.length, deliveriesBefore.length, 'Duplicate replay must not create a delivery')
assert.equal(attemptsAfter.length, attemptsBefore.length, 'Duplicate replay must not create an attempt')

const fixtureAfter = deliveriesAfter.filter((row) => row.idempotency_key === QA_IDEMPOTENCY_KEY)
assert.equal(fixtureAfter.length, 1)
assert.equal(fixtureAfter[0].id, fixture.id)
assert.equal(fixtureAfter[0].attempt_count, 1)
assert.equal(fixtureAfter[0].provider_message_id, null)
assert.equal(fixtureAfter[0].metadata?.network_call_performed, false)

const fixtureAttemptsAfter = attemptsAfter.filter((row) => row.delivery_id === fixture.id)
assert.equal(fixtureAttemptsAfter.length, 1)
assert.equal(fixtureAttemptsAfter[0].id, fixtureAttemptsBefore[0].id)
assert.equal(fixtureAttemptsAfter[0].attempt_number, 1)
assert.equal(fixtureAttemptsAfter[0].provider_message_id, null)
assert.equal(fixtureAttemptsAfter[0].response_metadata?.network_call_performed, false)

const settingsAfter = await requireData(
  await qa.supabase
    .from('workspace_outbound_email_settings')
    .select('enabled, mode, provider')
    .eq('workspace_id', qa.workspaceId),
  'outbound settings post-check',
)
assert.deepEqual(settingsAfter, [{ enabled: false, mode: 'disabled', provider: null }])

console.log('Controlled outbound idempotency replay PASS')
console.log(`Workspace: ${qa.workspaceName}`)
console.log(`Synthetic lead: ${lead.public_id}`)
console.log(`Logical delivery: ${fixture.public_id}`)
console.log(`Attempt count: ${fixtureAfter[0].attempt_count}`)
console.log('The real crm-outbound-email endpoint returned duplicate=true and created no new delivery or attempt. No provider call was performed.')
