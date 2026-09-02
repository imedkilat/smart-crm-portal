import { useEffect, useState } from 'react'
import { useWorkspace } from '../workspace-context'
import '../settings-ux.css'

const SIDEBAR_COLLAPSED_KEY = 'smartcrm:sidebar-collapsed'

function formatRole(role: string) {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function workspaceInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'W'
}

export default function WorkspaceSwitcher({ onSwitch }: { onSwitch?: () => void }) {
  const { activeWorkspace, workspaces, switchWorkspace } = useWorkspace()
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true')

  useEffect(() => {
    const shell = document.querySelector('.app-shell')
    shell?.classList.toggle('sidebar-collapsed', collapsed)
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed))

    return () => shell?.classList.remove('sidebar-collapsed')
  }, [collapsed])

  return (
    <>
      <button
        className="sidebar-collapse-toggle"
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? '›' : '‹'}
      </button>

      <div className={`workspace-switcher ${collapsed ? 'is-collapsed' : ''}`}>
        <button
          className="workspace-switcher-compact"
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label={`Expand sidebar. Active workspace: ${activeWorkspace.name}`}
          title={`${activeWorkspace.name} · ${formatRole(activeWorkspace.role)}`}
        >
          {workspaceInitial(activeWorkspace.name)}
        </button>

        <span className="workspace-switcher-copy">
          <small>ACTIVE WORKSPACE</small>
          <strong>{activeWorkspace.name}</strong>
        </span>
        {workspaces.length > 1 ? (
          <select
            aria-label="Active workspace"
            value={activeWorkspace.workspaceId}
            onChange={(event) => {
              switchWorkspace(event.target.value)
              onSwitch?.()
            }}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.workspaceId} value={workspace.workspaceId}>
                {workspace.name} · {formatRole(workspace.role)}
              </option>
            ))}
          </select>
        ) : <span className="workspace-switcher-role">{formatRole(activeWorkspace.role)}</span>}
      </div>
    </>
  )
}
