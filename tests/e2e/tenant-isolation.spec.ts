import { expect, test } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim()
const primaryEmail = process.env.E2E_PRIMARY_EMAIL?.trim()
const primaryPassword = process.env.E2E_PRIMARY_PASSWORD
const secondaryEmail = process.env.E2E_SECONDARY_EMAIL?.trim()
const secondaryPassword = process.env.E2E_SECONDARY_PASSWORD

const hasIsolationCredentials = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  primaryEmail &&
  primaryPassword &&
  secondaryEmail &&
  secondaryPassword,
)

const workspaceScopedTables = [
  'workspace_members',
  'leads',
  'lead_quotes',
  'lead_tasks',
  'lead_activities',
  'workspace_branding',
  'workspace_follow_up_settings',
  'workspace_outbound_email_settings',
  'workspace_quote_alert_settings',
] as const

type TenantSession = {
  client: SupabaseClient
  userId: string
  workspaceId: string
  role: string
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

  const userId = signIn.data.user!.id
  const membership = await client
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', userId)

  expect(membership.error).toBeNull()
  expect(membership.data, `QA identity ${email} must have exactly one visible workspace membership`).toHaveLength(1)

  const workspaceId = membership.data![0].workspace_id as string
  const role = membership.data![0].role as string

  const ownWorkspace = await client
    .from('workspaces')
    .select('id')
    .eq('id', workspaceId)

  expect(ownWorkspace.error).toBeNull()
  expect(ownWorkspace.data).toEqual([{ id: workspaceId }])

  return { client, userId, workspaceId, role }
}

async function expectForeignWorkspaceHidden(client: SupabaseClient, foreignWorkspaceId: string) {
  const workspace = await client
    .from('workspaces')
    .select('id')
    .eq('id', foreignWorkspaceId)

  expect(workspace.error).toBeNull()
  expect(workspace.data).toEqual([])

  for (const table of workspaceScopedTables) {
    const result = await client
      .from(table)
      .select('workspace_id')
      .eq('workspace_id', foreignWorkspaceId)
      .limit(1)

    expect(result.error, `${table} foreign-workspace read should be filtered by RLS`).toBeNull()
    expect(result.data, `${table} leaked a row from foreign workspace ${foreignWorkspaceId}`).toEqual([])
  }
}

test.describe('two-tenant RLS isolation', () => {
  test.skip(
    !hasIsolationCredentials,
    'Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, E2E_PRIMARY_EMAIL/PASSWORD, and E2E_SECONDARY_EMAIL/PASSWORD.',
  )

  test('two configured QA identities resolve distinct single-workspace contexts', async () => {
    const primary = await signInTenant(primaryEmail!, primaryPassword!)
    const secondary = await signInTenant(secondaryEmail!, secondaryPassword!)

    expect(primary.userId).not.toBe(secondary.userId)
    expect(primary.workspaceId).not.toBe(secondary.workspaceId)
    expect(primary.role).toBeTruthy()
    expect(secondary.role).toBeTruthy()
  })

  test('each QA identity is filtered from the other tenant across core CRM tables', async () => {
    const primary = await signInTenant(primaryEmail!, primaryPassword!)
    const secondary = await signInTenant(secondaryEmail!, secondaryPassword!)

    expect(primary.workspaceId).not.toBe(secondary.workspaceId)

    await expectForeignWorkspaceHidden(primary.client, secondary.workspaceId)
    await expectForeignWorkspaceHidden(secondary.client, primary.workspaceId)
  })
})
