import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const CONFIRMATION = 'SMART_CRM_AI_SCOPE_QA'
const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim()
const primaryEmail = process.env.E2E_PRIMARY_EMAIL?.trim()
const primaryPassword = process.env.E2E_PRIMARY_PASSWORD
const secondaryEmail = process.env.E2E_SECONDARY_EMAIL?.trim()
const secondaryPassword = process.env.E2E_SECONDARY_PASSWORD
const confirmation = process.env.AI_SCOPE_CONFIRMATION?.trim()

const required = {
  VITE_SUPABASE_URL: supabaseUrl,
  VITE_SUPABASE_ANON_KEY: supabaseAnonKey,
  E2E_PRIMARY_EMAIL: primaryEmail,
  E2E_PRIMARY_PASSWORD: primaryPassword,
  E2E_SECONDARY_EMAIL: secondaryEmail,
  E2E_SECONDARY_PASSWORD: secondaryPassword,
}

for (const [name, value] of Object.entries(required)) {
  assert.ok(value, `Missing required environment variable: ${name}`)
}
assert.equal(
  confirmation,
  CONFIRMATION,
  `AI scope regression refused. Set AI_SCOPE_CONFIRMATION=${CONFIRMATION}`,
)

function newClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}

async function signInTenant(label, email, password) {
  const client = newClient()
  const signIn = await client.auth.signInWithPassword({ email, password })
  assert.equal(signIn.error, null, `${label} sign-in failed`)
  assert.ok(signIn.data.user, `${label} user missing after sign-in`)
  assert.ok(signIn.data.session?.access_token, `${label} access token missing after sign-in`)

  const membership = await client
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', signIn.data.user.id)

  assert.equal(membership.error, null, `${label} membership lookup failed`)
  assert.equal(membership.data?.length, 1, `${label} must resolve exactly one visible workspace membership`)

  const workspaceId = membership.data[0].workspace_id
  const workspace = await client
    .from('workspaces')
    .select('id, name, public_id')
    .eq('id', workspaceId)
    .single()

  assert.equal(workspace.error, null, `${label} workspace lookup failed`)
  assert.ok(workspace.data, `${label} workspace missing`)

  const lead = await client
    .from('leads')
    .select('id, public_id, workspace_id')
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .not('public_id', 'is', null)
    .limit(1)
    .maybeSingle()

  assert.equal(lead.error, null, `${label} lead lookup failed`)
  assert.ok(lead.data?.public_id, `${label} requires one active lead with a public_id`)

  return {
    label,
    client,
    userId: signIn.data.user.id,
    accessToken: signIn.data.session.access_token,
    workspaceId,
    workspaceName: workspace.data.name,
    workspacePublicId: workspace.data.public_id,
    leadPublicId: lead.data.public_id,
  }
}

async function countOwnRows(tenant, table) {
  const result = await tenant.client
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', tenant.workspaceId)

  assert.equal(result.error, null, `${tenant.label} ${table} count failed`)
  assert.notEqual(result.count, null, `${tenant.label} ${table} count missing`)
  return result.count
}

async function snapshotAiState(tenant) {
  return {
    interactions: await countOwnRows(tenant, 'ai_interactions'),
    memories: await countOwnRows(tenant, 'ai_memories'),
  }
}

async function assertForeignLeadHidden(viewer, foreign) {
  const result = await viewer.client
    .from('leads')
    .select('public_id, workspace_id')
    .eq('public_id', foreign.leadPublicId)

  assert.equal(result.error, null, `${viewer.label} foreign lead RLS lookup errored`)
  assert.deepEqual(result.data, [], `${viewer.label} can read ${foreign.label}'s lead through RLS`)
}

async function invokeCopilot(tenant, { workspaceId, scopeType, scopeKey }) {
  const response = await fetch(`${supabaseUrl}/functions/v1/crm-ai-copilot`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${tenant.accessToken}`,
      'Content-Type': 'application/json',
      'x-workspace-id': workspaceId,
    },
    body: JSON.stringify({
      question: 'Smart CRM AI tenant-boundary QA. This request must be rejected before any upstream AI execution.',
      scope_type: scopeType,
      scope_key: scopeKey,
    }),
    signal: AbortSignal.timeout(20_000),
  })

  const raw = await response.text()
  let payload = {}
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    assert.fail(`crm-ai-copilot returned non-JSON HTTP ${response.status}`)
  }

  return { status: response.status, payload, raw }
}

async function assertWorkspaceForgeryRejected(viewer, foreign) {
  const result = await invokeCopilot(viewer, {
    workspaceId: foreign.workspaceId,
    scopeType: 'workspace',
    scopeKey: null,
  })

  assert.equal(result.status, 403, `${viewer.label} forged workspace should return 403: ${result.raw}`)
  assert.equal(result.payload?.error, 'Workspace access denied')
}

async function assertForeignLeadScopeRejected(viewer, foreign) {
  const result = await invokeCopilot(viewer, {
    workspaceId: viewer.workspaceId,
    scopeType: 'lead',
    scopeKey: foreign.leadPublicId,
  })

  assert.equal(result.status, 403, `${viewer.label} foreign lead scope should return 403: ${result.raw}`)
  assert.equal(result.payload?.error, 'Requested AI scope is not available in this workspace')
}

const primary = await signInTenant('primary', primaryEmail, primaryPassword)
const secondary = await signInTenant('secondary', secondaryEmail, secondaryPassword)

assert.notEqual(primary.userId, secondary.userId, 'QA identities must be distinct users')
assert.notEqual(primary.workspaceId, secondary.workspaceId, 'QA identities must resolve distinct workspaces')
assert.notEqual(primary.leadPublicId, secondary.leadPublicId, 'QA workspaces must use distinct lead fixtures')

await assertForeignLeadHidden(primary, secondary)
await assertForeignLeadHidden(secondary, primary)

const before = {
  primary: await snapshotAiState(primary),
  secondary: await snapshotAiState(secondary),
}

await assertWorkspaceForgeryRejected(primary, secondary)
await assertWorkspaceForgeryRejected(secondary, primary)
await assertForeignLeadScopeRejected(primary, secondary)
await assertForeignLeadScopeRejected(secondary, primary)

const after = {
  primary: await snapshotAiState(primary),
  secondary: await snapshotAiState(secondary),
}

assert.deepEqual(after, before, 'Rejected AI scope probes must not create AI interactions or memories')

console.log('Controlled AI scope boundary PASS')
console.log(`Primary workspace: ${primary.workspaceName} (${primary.workspacePublicId})`)
console.log(`Secondary workspace: ${secondary.workspaceName} (${secondary.workspacePublicId})`)
console.log(`Primary lead fixture: ${primary.leadPublicId}`)
console.log(`Secondary lead fixture: ${secondary.leadPublicId}`)
console.log(`AI state unchanged: ${JSON.stringify(after)}`)
console.log('Both forged-workspace and foreign-lead scope requests returned 403 before the n8n/model persistence path. No AI interaction or memory row was created.')
