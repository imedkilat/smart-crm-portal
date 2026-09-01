import type { WorkspaceContext } from './workspace'

export function workspaceStorageKey(userId: string) {
  return `smartcrm:active-workspace:${userId}`
}

export function selectActiveWorkspace(
  workspaces: WorkspaceContext[],
  savedWorkspaceId?: string | null,
  onboardingWorkspaceId?: string | null,
) {
  if (!workspaces.length) return null

  return workspaces.find((workspace) => workspace.workspaceId === savedWorkspaceId)
    || workspaces.find((workspace) => workspace.workspaceId === onboardingWorkspaceId)
    || workspaces[0]
}
