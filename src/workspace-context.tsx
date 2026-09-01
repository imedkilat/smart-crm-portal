import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import type { WorkspaceContext } from './lib/workspace'
import { selectActiveWorkspace, workspaceStorageKey } from './lib/workspaceSelection'

type WorkspaceMembership = { workspace_id: string; role: string; created_at: string }
type WorkspaceRow = { id: string; public_id: string; name: string; slug: string }

type ActiveWorkspaceValue = {
  activeWorkspace: WorkspaceContext
  workspaces: WorkspaceContext[]
  switchWorkspace: (workspaceId: string) => void
}

const ActiveWorkspaceContext = createContext<ActiveWorkspaceValue | null>(null)

export function WorkspaceProvider({ userId, initialWorkspace, children }: {
  userId: string
  initialWorkspace: WorkspaceContext
  children: ReactNode
}) {
  const [workspaces, setWorkspaces] = useState<WorkspaceContext[]>([])
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceContext | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadMemberships() {
      if (!supabase) {
        setError('Supabase is not configured for this environment.')
        return
      }

      const client = supabase as unknown as SupabaseClient
      const membershipResult = await client
        .from('workspace_members')
        .select('workspace_id, role, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })

      if (!active) return
      if (membershipResult.error || !membershipResult.data?.length) {
        setError(membershipResult.error?.message || 'No workspace membership found for this account.')
        return
      }

      const memberships = membershipResult.data as WorkspaceMembership[]
      const workspaceResult = await client
        .from('workspaces')
        .select('id, public_id, name, slug')
        .in('id', memberships.map((membership) => membership.workspace_id))

      if (!active) return
      if (workspaceResult.error) {
        setError(workspaceResult.error.message)
        return
      }

      const workspaceById = new Map((workspaceResult.data as WorkspaceRow[]).map((workspace) => [workspace.id, workspace]))
      const options = memberships.flatMap((membership) => {
        const workspace = workspaceById.get(membership.workspace_id)
        if (!workspace) return []
        return [{
          workspaceId: workspace.id,
          publicId: workspace.public_id,
          name: workspace.name,
          slug: workspace.slug,
          role: membership.role,
          planCode: workspace.id === initialWorkspace.workspaceId ? initialWorkspace.planCode : '',
        }]
      })

      const savedWorkspaceId = window.localStorage.getItem(workspaceStorageKey(userId))
      const selected = selectActiveWorkspace(options, savedWorkspaceId, initialWorkspace.workspaceId)
      if (!selected) {
        setError('No accessible workspace could be resolved for this account.')
        return
      }

      setWorkspaces(options)
      setActiveWorkspace(selected)
      window.localStorage.setItem(workspaceStorageKey(userId), selected.workspaceId)
    }

    void loadMemberships()
    return () => { active = false }
  }, [initialWorkspace, userId])

  const switchWorkspace = useCallback((workspaceId: string) => {
    const nextWorkspace = workspaces.find((workspace) => workspace.workspaceId === workspaceId)
    if (!nextWorkspace) return
    setActiveWorkspace(nextWorkspace)
    window.localStorage.setItem(workspaceStorageKey(userId), nextWorkspace.workspaceId)
  }, [userId, workspaces])

  const value = useMemo(() => activeWorkspace ? { activeWorkspace, workspaces, switchWorkspace } : null, [activeWorkspace, switchWorkspace, workspaces])

  if (error) return <div className="workspace-context-state" role="alert">{error}</div>
  if (!value) return <div className="workspace-context-state">Loading workspace access…</div>

  return <ActiveWorkspaceContext.Provider value={value}>{children}</ActiveWorkspaceContext.Provider>
}

export function useWorkspace() {
  const value = useContext(ActiveWorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider.')
  return value
}
