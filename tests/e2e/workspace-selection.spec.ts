import { expect, test } from '@playwright/test'
import type { WorkspaceContext } from '../../src/lib/workspace'
import { selectActiveWorkspace, workspaceStorageKey } from '../../src/lib/workspaceSelection'

function workspace(workspaceId: string): WorkspaceContext {
  return {
    workspaceId,
    publicId: `ws_${workspaceId}`,
    name: `Workspace ${workspaceId}`,
    slug: `workspace-${workspaceId}`,
    role: 'owner',
    planCode: 'starter',
  }
}

test.describe('active workspace selection', () => {
  const workspaces = [workspace('alpha'), workspace('beta')]

  test('restores only a saved workspace that remains accessible', () => {
    expect(selectActiveWorkspace(workspaces, 'beta', 'alpha')?.workspaceId).toBe('beta')
    expect(selectActiveWorkspace(workspaces, 'foreign', 'alpha')?.workspaceId).toBe('alpha')
  })

  test('uses the onboarding workspace before deterministic first-membership fallback', () => {
    expect(selectActiveWorkspace(workspaces, null, 'beta')?.workspaceId).toBe('beta')
    expect(selectActiveWorkspace(workspaces, null, 'foreign')?.workspaceId).toBe('alpha')
  })

  test('fails closed when there is no accessible membership', () => {
    expect(selectActiveWorkspace([], 'foreign', 'foreign')).toBeNull()
  })

  test('isolates persistence by authenticated user', () => {
    expect(workspaceStorageKey('user-a')).toBe('smartcrm:active-workspace:user-a')
    expect(workspaceStorageKey('user-a')).not.toBe(workspaceStorageKey('user-b'))
  })
})
