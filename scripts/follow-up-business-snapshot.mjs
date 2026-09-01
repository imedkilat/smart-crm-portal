import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { captureBusinessSnapshot, compareBusinessSnapshots } from './follow-up-business-snapshot-lib.mjs'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function option(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  const value = process.argv[index + 1]?.trim()
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a path`)
  return value
}

const supabaseUrl = required('VITE_SUPABASE_URL')
const supabaseAnonKey = required('VITE_SUPABASE_ANON_KEY')
const expectedWorkspaceId = process.env.FOLLOW_UP_EXPECTED_WORKSPACE_ID?.trim() || null
const expectedWorkspaceName = process.env.FOLLOW_UP_EXPECTED_WORKSPACE_NAME?.trim() || 'Smart CRM Starter QA'
const comparePath = option('--compare') || process.env.FOLLOW_UP_BASELINE_FILE?.trim() || null
const outputPath = option('--output') || process.env.FOLLOW_UP_SNAPSHOT_FILE?.trim() || null

const credentials = [
  {
    email: required('E2E_PRIMARY_EMAIL'),
    password: required('E2E_PRIMARY_PASSWORD'),
  },
  {
    email: required('E2E_SECONDARY_EMAIL'),
    password: required('E2E_SECONDARY_PASSWORD'),
  },
]

function client() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}

async function signInTenant({ email, password }) {
  const supabase = client()
  const auth = await supabase.auth.signInWithPassword({ email, password })
  assert.equal(auth.error, null, `Configured QA identity could not sign in: ${email}`)
  assert.ok(auth.data.user, `Configured QA identity has no user after sign-in: ${email}`)

  const membership = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', auth.data.user.id)

  assert.equal(membership.error, null, `Could not resolve workspace membership for ${email}`)
  assert.equal(membership.data?.length, 1, `QA identity ${email} must have exactly one visible workspace`)

  const workspaceId = membership.data[0].workspace_id
  const workspace = await supabase
    .from('workspaces')
    .select('id,name')
    .eq('id', workspaceId)

  assert.equal(workspace.error, null, `Could not resolve workspace for ${email}`)
  assert.deepEqual(workspace.data?.map(({ id }) => id), [workspaceId])

  return {
    client: supabase,
    actorUserId: auth.data.user.id,
    workspaceId,
    workspaceName: workspace.data[0].name,
  }
}

const sessions = await Promise.all(credentials.map(signInTenant))
assert.notEqual(sessions[0].workspaceId, sessions[1].workspaceId, 'QA identities must belong to distinct workspaces')

const matches = sessions.filter((session) => expectedWorkspaceId
  ? session.workspaceId === expectedWorkspaceId
  : session.workspaceName === expectedWorkspaceName)

assert.equal(
  matches.length,
  1,
  expectedWorkspaceId
    ? `Exactly one QA identity must resolve expected workspace ${expectedWorkspaceId}`
    : `Exactly one QA identity must resolve workspace named ${expectedWorkspaceName}`,
)

const target = matches[0]
const snapshot = await captureBusinessSnapshot({
  client: target.client,
  workspaceId: target.workspaceId,
  workspaceName: target.workspaceName,
  actorUserId: target.actorUserId,
})

let result = snapshot
if (comparePath) {
  const baseline = JSON.parse(await readFile(comparePath, 'utf8'))
  result = compareBusinessSnapshots(baseline, snapshot)
}

const serialized = `${JSON.stringify(result, null, 2)}\n`
if (outputPath) {
  await writeFile(outputPath, serialized, { encoding: 'utf8', flag: 'wx' })
  console.error(`Wrote read-only Follow-Up evidence to ${outputPath}`)
} else {
  process.stdout.write(serialized)
}

if (comparePath && !result.ok) process.exitCode = 1
