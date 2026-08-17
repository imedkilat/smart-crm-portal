import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import '../lead-drawer.css'

type Lead = Database['public']['Tables']['leads']['Row']

type Props = {
  lead: Lead
  onClose: () => void
  onUpdated: (lead: Lead) => void
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
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
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

function categoryClass(value: string | null) {
  const normalized = (value || '').toLowerCase()
  if (normalized === 'hot') return 'hot'
  if (normalized === 'warm') return 'warm'
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

export default function LeadProfileDrawer({ lead, onClose, onUpdated }: Props) {
  const [currentLead, setCurrentLead] = useState(lead)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<EditForm>(() => toEditForm(lead))
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCurrentLead(lead)
    setEditForm(toEditForm(lead))
  }, [lead])

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (editing) {
        setEditing(false)
        setEditForm(toEditForm(currentLead))
        setError(null)
        setWarning(null)
      } else {
        onClose()
      }
    }

    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [editing, currentLead, onClose])

  async function refreshRecord() {
    if (!supabase) return
    setRefreshing(true)
    setError(null)
    const { data, error: refreshError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', currentLead.id)
      .single()

    if (refreshError) {
      setError(refreshError.message)
    } else if (data) {
      const fresh = data as Lead
      setCurrentLead(fresh)
      setEditForm(toEditForm(fresh))
      onUpdated(fresh)
      setMessage('Record refreshed')
    }
    setRefreshing(false)
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
    if (!supabase) return

    setSaving(true)
    setMessage(null)
    setWarning(null)
    setError(null)

    const previousStatus = statusValue(currentLead)
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
      .eq('id', currentLead.id)
      .select('*')
      .single()

    if (updateError || !data) {
      setError(updateError?.message || 'Could not update lead.')
      setSaving(false)
      return
    }

    const updatedLead = data as Lead
    setCurrentLead(updatedLead)
    setEditForm(toEditForm(updatedLead))
    setEditing(false)
    onUpdated(updatedLead)

    if (routingChanged && updatedLead.routing_status) {
      try {
        await triggerStatusAutomation(previousStatus, updatedLead)
        setMessage(`Saved and routed as ${updatedLead.routing_status}`)
      } catch (automationError) {
        setMessage('Changes saved')
        setWarning(
          automationError instanceof Error
            ? `Routing status changed, but n8n did not start: ${automationError.message}`
            : 'Routing status changed, but n8n did not start.'
        )
      }
    } else {
      setMessage('Changes saved')
    }

    setSaving(false)
  }

  return (
    <div className="lead-drawer-layer" role="presentation" onMouseDown={() => !editing && onClose()}>
      <aside
        className="lead-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${currentLead.name || 'Lead'} details`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="lead-drawer-header">
          <div className="lead-drawer-identity">
            <span className="lead-drawer-avatar">{initials(currentLead.name)}</span>
            <div>
              <span className="mini-label">LEAD PROFILE</span>
              <h2>{currentLead.name || 'Unnamed lead'}</h2>
              <p>{currentLead.email || 'No email address'}</p>
            </div>
          </div>
          <button className="lead-drawer-close" type="button" onClick={onClose} aria-label="Close lead details">×</button>
        </div>

        {!editing ? (
          <>
            <div className="lead-drawer-badges">
              <span className={`category-pill ${categoryClass(statusValue(currentLead))}`}><i />Routing: {statusValue(currentLead)}</span>
              <span className="lead-ai-pill">AI: {currentLead.category || 'Unclassified'}</span>
              <span className="lead-intent-pill">{currentLead.intent || 'No intent'}</span>
              <span className="lead-source-pill">{currentLead.source || 'Unknown source'}</span>
            </div>

            <div className="lead-drawer-actions">
              {currentLead.email ? (
                <a className="button primary" href={`mailto:${currentLead.email}`}>Email lead</a>
              ) : (
                <button className="button primary" type="button" disabled>Email lead</button>
              )}
              <button className="button secondary" type="button" onClick={() => {
                setEditForm(toEditForm(currentLead))
                setEditing(true)
                setMessage(null)
                setWarning(null)
                setError(null)
              }}>Edit lead</button>
              <button className="button secondary" type="button" onClick={() => void refreshRecord()} disabled={refreshing}>
                {refreshing ? 'Refreshing…' : '↻ Refresh'}
              </button>
            </div>

            {message && <div className="lead-save-success" role="status">✓ {message}</div>}
            {warning && <div className="lead-save-warning" role="alert">⚠ {warning}</div>}
            {error && <div className="lead-save-error" role="alert">{error}</div>}

            <div className="lead-detail-grid">
              <LeadDetail label="Budget" value={currentLead.budget ? money(parseBudget(currentLead.budget)) : 'Not provided'} />
              <LeadDetail label="Lead ID" value={`#${currentLead.id}`} />
              <LeadDetail label="Added" value={new Date(currentLead.created_at).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} />
              <LeadDetail label="Source" value={currentLead.source || 'Unknown'} />
            </div>

            <section className="lead-drawer-section ai-section">
              <div className="lead-section-heading">
                <span className="spark-badge">✦</span>
                <div><span className="mini-label">AI CLASSIFICATION · LOCKED</span><h3>Lead summary</h3></div>
              </div>
              <p>{currentLead.summary || 'No AI summary is available for this lead.'}</p>
            </section>

            <section className="lead-drawer-section">
              <span className="mini-label">ORIGINAL INQUIRY · LOCKED</span>
              <h3>Message</h3>
              <p className="lead-message">{currentLead.message || 'No original message was saved.'}</p>
            </section>
          </>
        ) : (
          <form className="lead-edit-form" onSubmit={saveLead}>
            <div className="lead-edit-intro">
              <span className="mini-label">EDIT RECORD</span>
              <h3>Update operational details</h3>
              <p>Contact fields can be corrected. Changing routing status requests the matching n8n follow-up path.</p>
            </div>

            <div className="lead-edit-grid">
              <label><span>Name</span><input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} /></label>
              <label><span>Email</span><input type="email" value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} /></label>
              <label><span>Budget</span><input value={editForm.budget} onChange={(event) => setEditForm({ ...editForm, budget: event.target.value })} /></label>
              <label>
                <span>Routing status</span>
                <select value={editForm.routing_status} onChange={(event) => setEditForm({ ...editForm, routing_status: event.target.value })}>
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
                <div><strong>Classification evidence is read-only</strong><p>AI category, intent, source, summary and original inquiry stay untouched.</p></div>
              </div>
              <div className="locked-fields-grid">
                <LeadDetail label="AI category" value={currentLead.category || 'Unclassified'} />
                <LeadDetail label="Intent" value={currentLead.intent || 'No intent'} />
                <LeadDetail label="Source" value={currentLead.source || 'Unknown'} />
              </div>
            </div>

            {error && <div className="lead-save-error" role="alert">{error}</div>}

            <div className="lead-edit-actions">
              <button className="button secondary" type="button" onClick={() => {
                setEditing(false)
                setEditForm(toEditForm(currentLead))
                setError(null)
              }} disabled={saving}>Cancel</button>
              <button className="button primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          </form>
        )}
      </aside>
    </div>
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
