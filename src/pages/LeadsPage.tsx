import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import '../lead-drawer.css'

type Lead = Database['public']['Tables']['leads']['Row']

type Props = {
  onLoaded?: (leads: Lead[]) => void
  onAddLead?: () => void
}

type EditForm = {
  name: string
  email: string
  budget: string
  routing_status: string
}

const STATUS_WEBHOOK_URL =
  import.meta.env.VITE_N8N_STATUS_WEBHOOK_URL ||
  'https://tolakautomations.app.n8n.cloud/webhook-test/smart-crm-status-route'

function initials(name: string | null) {
  if (!name) return '—'
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function parseBudget(value: string | null) {
  if (!value) return 0
  const parsed = Number(value.replace(/[^0-9.]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function money(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function statusValue(lead: Lead) {
  return lead.routing_status || lead.category || 'Unclassified'
}

function categoryClass(category: string | null) {
  const value = (category || '').toLowerCase()
  if (value === 'hot') return 'hot'
  if (value === 'warm') return 'warm'
  return 'cold'
}

function toEditForm(lead: Lead): EditForm {
  return {
    name: lead.name || '',
    email: lead.email || '',
    budget: lead.budget || '',
    routing_status: lead.routing_status || lead.category || '',
  }
}

export default function LeadsPage({ onLoaded, onAddLead }: Props) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'all' | 'hot' | 'warm' | 'cold'>('all')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveWarning, setSaveWarning] = useState<string | null>(null)

  const loadLeads = useCallback(async (background = false) => {
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
      .order('created_at', { ascending: false })

    if (loadError) {
      setError(loadError.message)
    } else {
      const rows = data || []
      setLeads(rows)
      setLastUpdated(new Date())
      onLoaded?.(rows)

      setSelectedLead((current) => {
        if (!current) return null
        return rows.find((lead) => lead.id === current.id) || null
      })
    }

    setLoading(false)
    setRefreshing(false)
  }, [onLoaded])

  useEffect(() => {
    void loadLeads()
  }, [loadLeads])

  useEffect(() => {
    if (!selectedLead) return

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (editing) {
        setEditing(false)
        setEditForm(selectedLead ? toEditForm(selectedLead) : null)
        setSaveMessage(null)
        setSaveWarning(null)
      } else {
        setSelectedLead(null)
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [selectedLead, editing])

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return leads.filter((lead) => {
      const routing = statusValue(lead).toLowerCase()
      const matchesCategory = category === 'all' || routing === category
      if (!matchesCategory) return false
      if (!normalizedQuery) return true

      return [lead.name, lead.email, lead.intent, lead.category, lead.routing_status, lead.source, lead.summary, lead.message]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery))
    })
  }, [leads, query, category])

  const counts = useMemo(() => ({
    all: leads.length,
    hot: leads.filter((lead) => statusValue(lead).toLowerCase() === 'hot').length,
    warm: leads.filter((lead) => statusValue(lead).toLowerCase() === 'warm').length,
    cold: leads.filter((lead) => statusValue(lead).toLowerCase() === 'cold').length,
  }), [leads])

  function openLead(lead: Lead) {
    setSelectedLead(lead)
    setEditing(false)
    setEditForm(toEditForm(lead))
    setSaveMessage(null)
    setSaveWarning(null)
  }

  function startEditing() {
    if (!selectedLead) return
    setEditForm(toEditForm(selectedLead))
    setEditing(true)
    setSaveMessage(null)
    setSaveWarning(null)
  }

  function cancelEditing() {
    if (selectedLead) setEditForm(toEditForm(selectedLead))
    setEditing(false)
    setSaveMessage(null)
    setSaveWarning(null)
  }

  function changeEditField(field: keyof EditForm, value: string) {
    setEditForm((current) => current ? { ...current, [field]: value } : current)
  }

  async function triggerStatusAutomation(previousStatus: string, updatedLead: Lead) {
    const response = await fetch(STATUS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'routing_status_changed',
        lead_id: updatedLead.id,
        previous_status: previousStatus,
        routing_status: updatedLead.routing_status,
        changed_at: updatedLead.status_changed_at,
        lead: {
          name: updatedLead.name,
          email: updatedLead.email,
          budget: updatedLead.budget,
          message: updatedLead.message,
          category: updatedLead.category,
          intent: updatedLead.intent,
          summary: updatedLead.summary,
          source: updatedLead.source,
        },
      }),
    })

    if (!response.ok) throw new Error(`n8n returned ${response.status}`)
  }

  async function saveLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedLead || !editForm || !supabase) return

    setSaving(true)
    setSaveMessage(null)
    setSaveWarning(null)

    const previousStatus = statusValue(selectedLead)
    const nextStatus = editForm.routing_status.trim() || null
    const routingChanged = (nextStatus || 'Unclassified') !== previousStatus

    const updates: Database['public']['Tables']['leads']['Update'] = {
      name: editForm.name.trim() || null,
      email: editForm.email.trim() || null,
      budget: editForm.budget.trim() || null,
      routing_status: nextStatus,
      ...(routingChanged ? { status_changed_at: new Date().toISOString() } : {}),
    }

    const { data, error: updateError } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', selectedLead.id)
      .select('*')
      .single()

    if (updateError) {
      setSaveMessage(updateError.message)
      setSaving(false)
      return
    }

    const updatedLead = data as Lead
    const nextRows = leads.map((lead) => lead.id === updatedLead.id ? updatedLead : lead)
    setLeads(nextRows)
    setSelectedLead(updatedLead)
    setEditForm(toEditForm(updatedLead))
    setEditing(false)
    setLastUpdated(new Date())
    onLoaded?.(nextRows)

    if (routingChanged && updatedLead.routing_status) {
      try {
        await triggerStatusAutomation(previousStatus, updatedLead)
        setSaveMessage(`Saved and routed as ${updatedLead.routing_status}`)
      } catch (automationError) {
        setSaveMessage('Changes saved')
        setSaveWarning(
          automationError instanceof Error
            ? `Routing status changed, but the n8n automation did not start: ${automationError.message}`
            : 'Routing status changed, but the n8n automation did not start.'
        )
      }
    } else {
      setSaveMessage('Changes saved')
    }

    setSaving(false)
  }

  return (
    <>
      <section className="page-heading connected-page-heading">
        <div>
          <div className="eyebrow">LIVE CRM DATABASE</div>
          <h1>Leads</h1>
          <p>Search, filter and review every lead currently stored in Supabase.</p>
        </div>
        <button className="button primary" type="button" onClick={onAddLead}>+ Add lead</button>
      </section>

      {error && <div className="error-banner">Could not load leads: {error}</div>}

      <section className="lead-stat-strip" aria-label="Routing status counts">
        {(['all', 'hot', 'warm', 'cold'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`lead-stat ${category === item ? 'active' : ''}`}
            onClick={() => setCategory(item)}
          >
            <span>{item === 'all' ? 'All leads' : item[0].toUpperCase() + item.slice(1)}</span>
            <strong>{loading ? '—' : counts[item]}</strong>
          </button>
        ))}
      </section>

      <section className="panel leads-panel">
        <div className="leads-toolbar">
          <div className="leads-search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email, intent, source or AI summary..."
              aria-label="Search leads"
            />
          </div>

          <div className="leads-toolbar-actions">
            <button
              className={`leads-refresh-button ${refreshing ? 'refreshing' : ''}`}
              type="button"
              onClick={() => void loadLeads(true)}
              disabled={refreshing || loading}
              aria-label="Refresh leads"
              title="Refresh leads only"
            >
              <span aria-hidden="true">↻</span>
            </button>
            <div className="results-meta">
              <span className="results-count">{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
              {lastUpdated && (
                <small aria-live="polite">Updated {lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>
              )}
            </div>
          </div>
        </div>

        <div className={`table-wrap leads-table-wrap ${refreshing ? 'is-refreshing' : ''}`}>
          <table>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Intent</th>
                <th>Routing status</th>
                <th>Budget</th>
                <th>Source</th>
                <th>AI summary</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => {
                const routing = statusValue(lead)
                return (
                  <tr
                    key={lead.id}
                    className="lead-table-row"
                    tabIndex={0}
                    onClick={() => openLead(lead)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openLead(lead)
                      }
                    }}
                    aria-label={`Open ${lead.name || 'lead'} details`}
                  >
                    <td>
                      <div className="lead-cell">
                        <span className="avatar">{initials(lead.name)}</span>
                        <div>
                          <strong>{lead.name || 'Unnamed lead'}</strong>
                          <span>{lead.email || 'No email'}</span>
                        </div>
                      </div>
                    </td>
                    <td>{lead.intent || '—'}</td>
                    <td><span className={`category-pill ${categoryClass(routing)}`}><i />{routing}</span></td>
                    <td>{lead.budget ? money(parseBudget(lead.budget)) : '—'}</td>
                    <td>{lead.source || '—'}</td>
                    <td className="summary-cell" title={lead.summary || lead.message || ''}>{lead.summary || lead.message || '—'}</td>
                    <td>{new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  </tr>
                )
              })}
              {!loading && filtered.length === 0 && (
                <tr><td className="empty-cell" colSpan={7}>No leads match this view.</td></tr>
              )}
              {loading && (
                <tr><td className="empty-cell" colSpan={7}>Loading live leads…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedLead && (
        <div className="lead-drawer-layer" role="presentation" onMouseDown={() => !editing && setSelectedLead(null)}>
          <aside
            className="lead-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedLead.name || 'Lead'} details`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="lead-drawer-header">
              <div className="lead-drawer-identity">
                <span className="lead-drawer-avatar">{initials(selectedLead.name)}</span>
                <div>
                  <span className="mini-label">LEAD PROFILE</span>
                  <h2>{selectedLead.name || 'Unnamed lead'}</h2>
                  <p>{selectedLead.email || 'No email address'}</p>
                </div>
              </div>
              <button className="lead-drawer-close" type="button" onClick={() => setSelectedLead(null)} aria-label="Close lead details">×</button>
            </div>

            {!editing ? (
              <>
                <div className="lead-drawer-badges">
                  <span className={`category-pill ${categoryClass(statusValue(selectedLead))}`}><i />Routing: {statusValue(selectedLead)}</span>
                  <span className="lead-ai-pill">AI: {selectedLead.category || 'Unclassified'}</span>
                  <span className="lead-intent-pill">{selectedLead.intent || 'No intent'}</span>
                  <span className="lead-source-pill">{selectedLead.source || 'Unknown source'}</span>
                </div>

                <div className="lead-drawer-actions">
                  {selectedLead.email ? (
                    <a className="button primary" href={`mailto:${selectedLead.email}`}>Email lead</a>
                  ) : (
                    <button className="button primary" type="button" disabled>Email lead</button>
                  )}
                  <button className="button secondary" type="button" onClick={startEditing}>Edit lead</button>
                  <button className="button secondary" type="button" onClick={() => void loadLeads(true)}>↻ Refresh</button>
                </div>

                {saveMessage && <div className="lead-save-success" role="status">✓ {saveMessage}</div>}
                {saveWarning && <div className="lead-save-warning" role="alert">⚠ {saveWarning}</div>}

                <div className="lead-detail-grid">
                  <LeadDetail label="Budget" value={selectedLead.budget ? money(parseBudget(selectedLead.budget)) : 'Not provided'} />
                  <LeadDetail label="Lead ID" value={`#${selectedLead.id}`} />
                  <LeadDetail label="Added" value={new Date(selectedLead.created_at).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} />
                  <LeadDetail label="Source" value={selectedLead.source || 'Unknown'} />
                </div>

                <section className="lead-drawer-section ai-section">
                  <div className="lead-section-heading">
                    <span className="spark-badge">✦</span>
                    <div><span className="mini-label">AI CLASSIFICATION · LOCKED</span><h3>Lead summary</h3></div>
                  </div>
                  <p>{selectedLead.summary || 'No AI summary is available for this lead.'}</p>
                </section>

                <section className="lead-drawer-section">
                  <span className="mini-label">ORIGINAL INQUIRY · LOCKED</span>
                  <h3>Message</h3>
                  <p className="lead-message">{selectedLead.message || 'No original message was saved.'}</p>
                </section>
              </>
            ) : editForm && (
              <form className="lead-edit-form" onSubmit={saveLead}>
                <div className="lead-edit-intro">
                  <span className="mini-label">EDIT RECORD</span>
                  <h3>Update operational details</h3>
                  <p>Contact fields can be corrected. Changing routing status also requests the matching n8n follow-up path.</p>
                </div>

                <div className="lead-edit-grid">
                  <label><span>Name</span><input value={editForm.name} onChange={(event) => changeEditField('name', event.target.value)} /></label>
                  <label><span>Email</span><input type="email" value={editForm.email} onChange={(event) => changeEditField('email', event.target.value)} /></label>
                  <label><span>Budget</span><input value={editForm.budget} onChange={(event) => changeEditField('budget', event.target.value)} /></label>
                  <label>
                    <span>Routing status</span>
                    <select value={editForm.routing_status} onChange={(event) => changeEditField('routing_status', event.target.value)}>
                      <option value="">Unclassified</option>
                      <option value="Hot">Hot</option>
                      <option value="Warm">Warm</option>
                      <option value="Cold">Cold</option>
                    </select>
                    <small className="field-helper">Changing this can trigger the matching n8n route.</small>
                  </label>
                </div>

                <div className="locked-fields-card">
                  <div className="locked-fields-heading">
                    <span>🔒</span>
                    <div><strong>Classification evidence is read-only</strong><p>AI category, intent, source, summary and original inquiry stay untouched so the original classification remains auditable.</p></div>
                  </div>
                  <div className="locked-fields-grid">
                    <LeadDetail label="AI category" value={selectedLead.category || 'Unclassified'} />
                    <LeadDetail label="Intent" value={selectedLead.intent || 'No intent'} />
                    <LeadDetail label="Source" value={selectedLead.source || 'Unknown'} />
                  </div>
                </div>

                {saveMessage && <div className="lead-save-error" role="alert">{saveMessage}</div>}

                <div className="lead-edit-actions">
                  <button className="button secondary" type="button" onClick={cancelEditing} disabled={saving}>Cancel</button>
                  <button className="button primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
                </div>
              </form>
            )}
          </aside>
        </div>
      )}
    </>
  )
}

function LeadDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="lead-detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
