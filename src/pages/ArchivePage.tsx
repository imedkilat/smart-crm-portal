import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import '../archive.css'
import { useWorkspace } from '../workspace-context'

type Lead = Database['public']['Tables']['leads']['Row']

type Props = {
  onRestored?: (lead: Lead) => void
  onBack?: () => void
}

function initials(name: string | null) {
  if (!name) return '—'
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

function statusValue(lead: Lead) {
  return lead.routing_status || lead.category || 'Unclassified'
}

function statusClass(value: string | null) {
  const normalized = (value || '').toLowerCase()
  if (normalized === 'hot') return 'hot'
  if (normalized === 'warm') return 'warm'
  if (normalized === 'cold') return 'cold'
  return 'neutral'
}

export default function ArchivePage({ onRestored, onBack }: Props) {
  const { activeWorkspace } = useWorkspace()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [restoringId, setRestoringId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const loadArchived = useCallback(async (background = false) => {
    if (!supabase) {
      setError('Supabase is not configured for this environment.')
      setLoading(false)
      setRefreshing(false)
      return
    }

    if (background) setRefreshing(true)
    else setLoading(true)
    setError(null)

    const { data, error: loadError } = await supabase
      .from('leads')
      .select('*')
      .eq('workspace_id', activeWorkspace.workspaceId)
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })

    if (loadError) {
      setError(loadError.message)
    } else {
      setLeads((data || []) as Lead[])
      setLastUpdated(new Date())
    }

    setLoading(false)
    setRefreshing(false)
  }, [activeWorkspace.workspaceId])

  useEffect(() => { void loadArchived() }, [loadArchived])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return leads
    return leads.filter((lead) => [
      lead.name,
      lead.email,
      lead.source,
      lead.intent,
      lead.routing_status,
      lead.category,
      lead.summary,
      lead.message,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalized)))
  }, [leads, query])

  async function restoreLead(lead: Lead) {
    if (!supabase) return
    const confirmed = window.confirm(`Restore ${lead.name || 'this lead'} to the active CRM?\n\nThis does not trigger a routing automation. The lead simply returns to active views.`)
    if (!confirmed) return

    setRestoringId(lead.id)
    setError(null)
    setMessage(null)

    const { data, error: restoreError } = await supabase
      .from('leads')
      .update({ archived_at: null })
      .eq('id', lead.id)
      .eq('workspace_id', activeWorkspace.workspaceId)
      .select('*')
      .single()

    if (restoreError || !data) {
      setError(restoreError?.message || 'Could not restore lead.')
    } else {
      const restored = data as Lead
      setLeads((current) => current.filter((item) => item.id !== restored.id))
      setLastUpdated(new Date())
      setMessage(`${restored.name || 'Lead'} restored to the active CRM.`)
      onRestored?.(restored)
    }

    setRestoringId(null)
  }

  return (
    <>
      <section className="page-heading archive-heading">
        <div>
          <div className="eyebrow">SAFE DATA RETENTION</div>
          <h1>Archive</h1>
          <p>Review and restore leads removed from active CRM views without deleting their history.</p>
        </div>
        <div className="heading-actions">
          {onBack && <button className="button secondary" type="button" onClick={onBack}>← Settings</button>}
          <button className="button secondary" type="button" onClick={() => void loadArchived(true)} disabled={refreshing || loading}>
            {refreshing ? 'Refreshing…' : '↻ Refresh archive'}
          </button>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}
      {message && <div className="archive-success" role="status">✓ {message}</div>}

      <section className="archive-summary-grid">
        <article className="panel archive-summary-card">
          <span className="mini-label">ARCHIVED RECORDS</span>
          <strong>{loading ? '—' : leads.length}</strong>
          <p>Preserved in Supabase</p>
        </article>
        <article className="panel archive-summary-card">
          <span className="mini-label">RESTORE BEHAVIOR</span>
          <strong>No automation</strong>
          <p>Restoring does not fire Hot, Warm or Cold follow-up</p>
        </article>
        <article className="panel archive-summary-card">
          <span className="mini-label">DATA SAFETY</span>
          <strong>History retained</strong>
          <p>Routing audit events remain attached to the lead</p>
        </article>
      </section>

      <section className="panel archive-panel">
        <div className="archive-toolbar">
          <div className="archive-search">
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search archived leads..." aria-label="Search archived leads" />
          </div>
          <div className="archive-results-meta">
            <strong>{filtered.length} result{filtered.length === 1 ? '' : 's'}</strong>
            {lastUpdated && <span>Updated {lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
          </div>
        </div>

        <div className={`table-wrap archive-table-wrap ${refreshing ? 'is-refreshing' : ''}`}>
          <table>
            <thead>
              <tr><th>Lead</th><th>Routing</th><th>Intent</th><th>Source</th><th>Archived</th><th>Action</th></tr>
            </thead>
            <tbody>
              {filtered.map((lead) => {
                const routing = statusValue(lead)
                return (
                  <tr key={lead.id}>
                    <td>
                      <div className="lead-cell">
                        <span className="avatar">{initials(lead.name)}</span>
                        <div><strong>{lead.name || 'Unnamed lead'}</strong><span>{lead.email || 'No email'}</span></div>
                      </div>
                    </td>
                    <td><span className={`archive-status ${statusClass(routing)}`}><i />{routing}</span></td>
                    <td>{lead.intent || '—'}</td>
                    <td>{lead.source || '—'}</td>
                    <td>{lead.archived_at ? new Date(lead.archived_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
                    <td><button className="archive-restore-button" type="button" onClick={() => void restoreLead(lead)} disabled={restoringId === lead.id}>{restoringId === lead.id ? 'Restoring…' : 'Restore'}</button></td>
                  </tr>
                )
              })}
              {!loading && filtered.length === 0 && <tr><td className="empty-cell" colSpan={6}>{query.trim() ? 'No archived leads match your search.' : 'Archive is empty.'}</td></tr>}
              {loading && <tr><td className="empty-cell" colSpan={6}>Loading archived leads…</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
