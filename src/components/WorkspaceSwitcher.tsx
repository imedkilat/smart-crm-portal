import { useWorkspace } from '../workspace-context'

function formatRole(role: string) {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function WorkspaceSwitcher({ onSwitch }: { onSwitch?: () => void }) {
  const { activeWorkspace, workspaces, switchWorkspace } = useWorkspace()

  return (
    <label className="workspace-switcher">
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
    </label>
  )
}
