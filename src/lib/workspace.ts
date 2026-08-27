import { supabase } from './supabase'

export type WorkspaceContext = {
  workspaceId: string
  publicId: string
  name: string
  slug: string
  role: string
  planCode: string
}

export type WorkspaceOnboardingResult =
  | { ok: true; workspace: WorkspaceContext }
  | { ok: false; message: string }

function onboardingMessage(message: string) {
  const value = message.toLowerCase()

  if (value.includes('workspace name must be at least')) {
    return 'Enter a workspace name with at least 2 characters.'
  }

  if (value.includes('100 characters')) {
    return 'Keep the workspace name to 100 characters or fewer.'
  }

  if (value.includes('authentication required') || value.includes('jwt')) {
    return 'Your session expired. Sign in again to finish opening your workspace.'
  }

  return 'We could not finish workspace setup. Try again, or sign out and sign back in.'
}

export async function ensureWorkspaceOnboarding(workspaceName?: string | null): Promise<WorkspaceOnboardingResult> {
  if (!supabase) {
    return { ok: false, message: 'Supabase is not configured for this environment.' }
  }

  const { data, error } = await supabase.rpc('ensure_workspace_onboarding', {
    p_workspace_name: workspaceName?.trim() || null,
  })

  if (error) {
    console.error('Workspace onboarding failed', { code: error.code, message: error.message })
    return { ok: false, message: onboardingMessage(error.message) }
  }

  const row = data?.[0]
  if (!row) {
    return { ok: false, message: 'Workspace setup returned no workspace. Try signing in again.' }
  }

  return {
    ok: true,
    workspace: {
      workspaceId: row.workspace_id,
      publicId: row.workspace_public_id,
      name: row.workspace_name,
      slug: row.workspace_slug,
      role: row.workspace_role,
      planCode: row.plan_code,
    },
  }
}
