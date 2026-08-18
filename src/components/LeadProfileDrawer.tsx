import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import '../lead-drawer.css'

type Lead = Database['public']['Tables']['leads']['Row']
type RoutingHistory = Database['public']['Tables']['lead_routing_history']['Row']

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

const AUTOMATION_COOLDOWN_MS = 24 * 60 * 60 * 1000

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

function routingResultLabel(item: RoutingHistory) {
  if (item.automation_result === 'accepted') return 'Automation started'
  if (item.automation_result === 'suppressed_24h') return 'Automation suppressed'
  if (item.automation_result === 'failed') return 'Automation failed'
  return item.automation_result.replace(/_/g, ' ')
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
  const [routingHistory, setRoutingHistory] = useState<RoutingHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    setCurrentLead(lead)
    setEditForm(toEditForm(lead))
  }, [lead])

  useEffect(() => {
    void loadRoutingHistory(lead.id)
  }, [lead.id])

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

  async function loadRoutingHistory(leadId: number) {
    if (!supabase) return
    setHistoryLoading(true)
    const { data } = await supabase
      .from('lead_routing_history')
      .select('*')
      .eq('lead_id', leadId)
      .order('changed_at', { ascending: false })
      .limit(6)

    setRoutingHistory((data || []) as RoutingHistory[])
    setHistoryLoading(false)
  }

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
      await loadRoutingHistory(fresh.id)
      setMessage('Record refreshed')
    }
    setRefreshing(false)
  }

  async function triggerStatusAutomation(previousStatus: string, updatedLead: Lead, eventId: string) {
    const { invokeSecureAutomation } = await import('../lib/secureFunctions')
    await invokeSecureAutomation('crm-status-route', {
      event: 'routing_status_changed',
      event_id: eventId,
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
    })
  }

  async function logRoutingEvent(params: {
    eventKey: string
    leadId: number
    fromStatus: string
    toStatus: string
    changedAt: string
    automationTriggered: boolean
    automationResult: string
  }) {
    if (!supabase) return
    await supabase.from('lead_routing_history').insert({
      event_key: params.eventKey,
      lead_id: params.leadId,
      from_status: params.fromStatus,
      to_status: params.toStatus,
      changed_at: params.changedAt,
      automation_triggered: params.automationTriggered,
      automation_result: params.automationResult,
    })
  }

  async function recentlyAutomated(leadId: number, toStatus: string) {
    if (!supabase) return false
    const cutoff = new Date(Date.now() - AUTOMATION_COOLDOWN_MS).toISOString()
    const { data } = await supabase
      .from('lead_routing_history')
      .select('id')
      .eq('lead_id', leadId)
      .eq('to_status', toStatus)
      .eq('automation_triggered', true)
      .eq('automation_result', 'accepted')
      .gte('changed_at', cutoff)
      .limit(1)

    return Boolean(data?.length)
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
    const changedAt = new Date().toISOString()

    const updates: Database['public']['Tables']['leads']['Update'] = {
      name: editForm.name.trim() || null,
      email: editForm.email.trim() || null,
      budget: editForm.budget.trim() || null,
      routing_status: nextStatus,
      ...(routingChanged ? { status_changed_at: changedAt } : {}),
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
      const eventKey = crypto.randomUUID()
      const duplicateRisk = await recentlyAutomated(updatedLead.id, updatedLead.routing_status)

      if (duplicateRisk) {
        await logRoutingEvent({
          eventKey,
          leadId: updatedLead.id,
          fromStatus: previousStatus,
          toStatus: updatedLead.routing_status,
          changedAt,
          automationTriggered: false,
          automationResult: 'suppressed_24h',
        })
        setMessage(`Saved as ${updatedLead.routing_status}`)
        setWarning(`The ${updatedLead.routing_status} automation was not repeated because this lead already ran through the same route within the last 24 hours.`)
      } else {
        try {
          await triggerStatusAutomation(previousStatus, updatedLead, eventKey)
          await logRoutingEvent({
            eventKey,
            leadId: updatedLead.id,
            fromStatus: previousStatus,
            toStatus: updatedLead.routing_status,
            changedAt,
            automationTriggered: true,
            automationResult: 'accepted',
          })
          setMessage(`Saved and routed as ${updatedLead.routing_status}`)
        } catch (automationError) {
          await logRoutingEvent({
            eventKey,
            leadId: updatedLead.id,
            fromStatus: previousStatus,
            toStatus: updatedLead.routing_status,
            changedAt,
            automationTriggered: false,
            automationResult: 'failed',
          })
          setMessage('Changes saved')
          setWarning(
            automationError instanceof Error
              ? `Routing status changed, but automation did not start: ${automationError.message}`
              : 'Routing status changed, but automation did not start.'
          )
        }
      }
      await loadRoutingHistory(updatedLead.id)
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

            <section className="lead-drawer-section routing-history-section">
              <div className="routing-history-heading">
                <div><span className="mini-label">ROUTING AUDIT</span><h3>Status history</h3></div>
                <span className="routing-cooldown-pill">24h duplicate guard</span>
              </div>
              {historyLoading ? (
                <p className="routing-history-empty">Loading routing history…</p>
              ) : routingHistory.length ? (
                <div className="routing-history-list">
                  {routingHistory.map((item) => (
                    <div className="routing-history-item" key={item.id}>
                      <span className={`routing-history-dot ${categoryClass(item.to_status)}`} />
                      <div>
                        <strong>{item.from_status || 'Unclassified'} → {item.to_status}</strong>
                        <span>{routingResultLabel(item)}</span>
                      </div>
                      <time>{new Date(item.changed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="routing-history-empty">No routing changes have been logged yet.</p>
              )}
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
                <small className="field-helper">Changing this can trigger the matching n8n route. Repeating the same route within 24 hours is automatically suppressed.</small>
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
