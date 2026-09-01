import { expect, test } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim()
const primaryEmail = process.env.E2E_PRIMARY_EMAIL?.trim()
const primaryPassword = process.env.E2E_PRIMARY_PASSWORD
const secondaryEmail = process.env.E2E_SECONDARY_EMAIL?.trim()
const secondaryPassword = process.env.E2E_SECONDARY_PASSWORD

const hasTelemetryCredentials = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  primaryEmail &&
  primaryPassword &&
  secondaryEmail &&
  secondaryPassword,
)

type TenantSession = {
  client: SupabaseClient
  workspaceId: string
}

type AutomationRun = {
  id: string
  workspace_id: string
  automation_key: string
  source: string
  trigger_type: string
  status: string
  run_ref: string | null
  metadata: Record<string, unknown> | null
  error_code: string | null
  error_message: string | null
}

function newClient() {
  return createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}

async function signInTenant(email: string, password: string): Promise<TenantSession> {
  const client = newClient()
  const signIn = await client.auth.signInWithPassword({ email, password })
  expect(signIn.error, `Sign-in failed for configured QA identity ${email}`).toBeNull()
  expect(signIn.data.user).not.toBeNull()

  const membership = await client
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', signIn.data.user!.id)

  expect(membership.error).toBeNull()
  expect(membership.data, `QA identity ${email} must have exactly one visible workspace membership`).toHaveLength(1)

  return {
    client,
    workspaceId: membership.data![0].workspace_id as string,
  }
}

async function readRuns(client: SupabaseClient) {
  const result = await client
    .from('automation_runs')
    .select('id,workspace_id,automation_key,source,trigger_type,status,run_ref,metadata,error_code,error_message')
    .order('started_at', { ascending: false })
    .limit(100)

  expect(result.error).toBeNull()
  return (result.data || []) as AutomationRun[]
}

function expectNoSecretLikeTelemetry(run: AutomationRun) {
  const inspectable = JSON.stringify({
    metadata: run.metadata || {},
    error_code: run.error_code,
    error_message: run.error_message,
  })

  expect(inspectable).not.toMatch(/authorization|bearer\s|api[_-]?key|access[_-]?token|secret/i)
}

test.describe('Automation Health Center telemetry contract', () => {
  test.skip(
    !hasTelemetryCredentials,
    'Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, E2E_PRIMARY_EMAIL/PASSWORD, and E2E_SECONDARY_EMAIL/PASSWORD.',
  )

  test('automation_runs stays tenant-scoped for both QA identities', async () => {
    const primary = await signInTenant(primaryEmail!, primaryPassword!)
    const secondary = await signInTenant(secondaryEmail!, secondaryPassword!)

    expect(primary.workspaceId).not.toBe(secondary.workspaceId)

    const [primaryRuns, secondaryRuns] = await Promise.all([
      readRuns(primary.client),
      readRuns(secondary.client),
    ])

    expect(primaryRuns.every((run) => run.workspace_id === primary.workspaceId)).toBe(true)
    expect(secondaryRuns.every((run) => run.workspace_id === secondary.workspaceId)).toBe(true)

    const [primaryForeign, secondaryForeign] = await Promise.all([
      primary.client.from('automation_runs').select('id').eq('workspace_id', secondary.workspaceId).limit(1),
      secondary.client.from('automation_runs').select('id').eq('workspace_id', primary.workspaceId).limit(1),
    ])

    expect(primaryForeign.error).toBeNull()
    expect(primaryForeign.data).toEqual([])
    expect(secondaryForeign.error).toBeNull()
    expect(secondaryForeign.data).toEqual([])
  })

  test('Follow-Up terminal telemetry has safe normalized shape when present', async () => {
    const primary = await signInTenant(primaryEmail!, primaryPassword!)
    const secondary = await signInTenant(secondaryEmail!, secondaryPassword!)

    const [primaryRuns, secondaryRuns] = await Promise.all([
      readRuns(primary.client),
      readRuns(secondary.client),
    ])

    const followUpRuns = [...primaryRuns, ...secondaryRuns]
      .filter((run) => run.automation_key === 'follow-up-engine')

    expect(followUpRuns.length, 'Expected at least one existing Follow-Up telemetry fixture across the two QA workspaces').toBeGreaterThan(0)

    for (const run of followUpRuns) {
      expect(run.source).toBe('n8n')
      expect(run.trigger_type).toBe('scheduled')
      expect(['succeeded', 'failed', 'suppressed']).toContain(run.status)
      expect(run.run_ref).toBeTruthy()
      expectNoSecretLikeTelemetry(run)
    }
  })
})
