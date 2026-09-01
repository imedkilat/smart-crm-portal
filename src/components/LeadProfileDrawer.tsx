import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatLeadBudget } from '../lib/currency'
import type { Database } from '../types/database'
import '../lead-drawer.css'
import '../lead-ops.css'
import '../lead-activity.css'

type Lead = Database['public']['Tables']['leads']['Row']
type RoutingHistory = Database['public']['Tables']['lead_routing_history']['Row']
type LeadNote = Database['public']['Tables']['lead_notes']['Row']
type LeadTask = Database['public']['Tables']['lead_tasks']['Row']
type LeadActivity = Database['public']['Tables']['lead_activities']['Row']

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

function formatActivityDate(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function activityIcon(type: string) {
  if (type === 'note_added') return 'N'
  if (type === 'task_created') return '+'
  if (type === 'task_completed') return '✓'
  if (type === 'task_reopened') return '↻'
  if (type === 'pipeline_stage_changed') return '→'
  return '•'
}

function activityDetail(activity: LeadActivity) {
  const meta = activity.metadata || {}
  if (activity.activity_type === 'pipeline_stage_changed') {
    const from = typeof meta.from_stage === 'string' ? meta.from_stage : 'Unstaged'
    const to = typeof meta.to_stage === 'string' ? meta.to_stage : 'Unstaged'
    return `${from} → ${to}`
  }
  if (typeof meta.task_title === 'string') return meta.task_title
  if (typeof meta.note_id === 'string') return meta.note_id
  return activity.public_id
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
  const [notes, setNotes] = useState<LeadNote[]>([])
  const [tasks, setTasks] = useState<LeadTask[]>([])
  const [activities, setActivities] = useState<LeadActivity[]>([])
  const [opsLoading, setOpsLoading] = useState(false)
  const [opsError, setOpsError] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDueAt, setTaskDueAt] = useState('')
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high'>('medium')
  const [savingTask, setSavingTask] = useState(false)

  useEffect(() => {
    setCurrentLead(lead)
    setEditForm(toEditForm(lead))
  }, [lead])

  useEffect(() => {
    void loadRoutingHistory(lead.id)
    void loadLeadOps(lead.id)
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
      .eq('workspace_id', currentLead.workspace_id!)
      .order('changed_at', { ascending: false })
      .limit(6)

    setRoutingHistory((data || []) as RoutingHistory[])
    setHistoryLoading(false)
  }

  async function loadLeadOps(leadId: number) {
    if (!supabase) return
    setOpsLoading(true)
    setOpsError(null)

    const [notesResult, tasksResult, activitiesResult] = await Promise.all([
      supabase
        .from('lead_notes')
        .select('*')
        .eq('lead_id', leadId)
        .eq('workspace_id', currentLead.workspace_id!)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('lead_tasks')
        .select('*')
        .eq('lead_id', leadId)
        .eq('workspace_id', currentLead.workspace_id!)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('lead_activities')
        .select('*')
        .eq('lead_id', leadId)
        .eq('workspace_id', currentLead.workspace_id!)
        .order('occurred_at', { ascending: false })
        .limit(40),
    ])

    if (notesResult.error || tasksResult.error || activitiesResult.error) {
      setOpsError(notesResult.error?.message || tasksResult.error?.message || activitiesResult.error?.message || 'Could not load lead operations.')
    } else {
      setNotes((notesResult.data || []) as LeadNote[])
      setActivities((activitiesResult.data || []) as LeadActivity[])
      const rows = (tasksResult.data || []) as LeadTask[]
      setTasks([...rows].sort((a, b) => {
        const aDone = a.status === 'done' ? 1 : 0
        const bDone = b.status === 'done' ? 1 : 0
        if (aDone !== bDone) return aDone - bDone
        const aDue = a.due_at ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER
        const bDue = b.due_at ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER
        return aDue - bDue
      }))
    }

    setOpsLoading(false)
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = noteDraft.trim()
    if (!supabase || !body) return
    if (!currentLead.workspace_id) {
      setOpsError('This lead is not assigned to a workspace yet.')
      return
    }

    setSavingNote(true)
    setOpsError(null)
    const { error: insertError } = await supabase.from('lead_notes').insert({
      workspace_id: currentLead.workspace_id,
      lead_id: currentLead.id,
      body,
    })

    if (insertError) {
      setOpsError(insertError.message)
    } else {
      setNoteDraft('')
      await loadLeadOps(currentLead.id)
    }
    setSavingNote(false)
  }

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = taskTitle.trim()
    if (!supabase || !title) return
    if (!currentLead.workspace_id) {
      setOpsError('This lead is not assigned to a workspace yet.')
      return
    }

    setSavingTask(true)
    setOpsError(null)

    const dueAt = taskDueAt ? new Date(taskDueAt) : null
    const { error: insertError } = await supabase.from('lead_tasks').insert({
      workspace_id: currentLead.workspace_id,
      lead_id: currentLead.id,
      title,
      priority: taskPriority,
      due_at: dueAt && Number.isFinite(dueAt.getTime()) ? dueAt.toISOString() : null,
    })

    if (insertError) {
      setOpsError(insertError.message)
    } else {
      setTaskTitle('')
      setTaskDueAt('')
      setTaskPriority('medium')
      await loadLeadOps(currentLead.id)
    }
    setSavingTask(false)
  }

  async function toggleTask(task: LeadTask) {
    if (!supabase) return
    setOpsError(null)
    const done = task.status !== 'done'
    const now = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('lead_tasks')
      .update({
        status: done ? 'done' : 'open',
        completed_at: done ? now : null,
        updated_at: now,
      })
      .eq('id', task.id)
      .eq('workspace_id', currentLead.workspace_id!)

    if (updateError) {
      setOpsError(updateError.message)
    } else {
      await loadLeadOps(currentLead.id)
    }
  }

  async function refreshRecord() {
    if (!supabase) return
    setRefreshing(true)
    setError(null)
    const { data, error: refreshError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', currentLead.id)
      .eq('workspace_id', currentLead.workspace_id!)
      .single()

    if (refreshError) {
      setError(refreshError.message)
    } else if (data) {
      const fresh = data as Lead
      setCurrentLead(fresh)
      setEditForm(toEditForm(fresh))
      onUpdated(fresh)
      await Promise.all([loadRoutingHistory(fresh.id), loadLeadOps(fresh.id)])
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
      lead_public_id: updatedLead.public_id,
      previous_status: previousStatus,
      routing_status: updatedLead.routing_status,
      changed_at: updatedLead.status_changed_at,
      lead: {
        name: updatedLead.name,
        email: updatedLead.email,
        budget: updatedLead.budget,
        currency_code: updatedLead.currency_code,
        message: updatedLead.message,
        category: updatedLead.category,
        intent: updatedLead.intent,
        summary: updatedLead.summary,
        source: updatedLead.source,
      },
    }, { workspaceId: updatedLead.workspace_id || undefined })
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
      workspace_id: currentLead.workspace_id!,
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
      .eq('workspace_id', currentLead.workspace_id!)
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
      currency_code: currentLead.currency_code || 'USD',
      routing_status: nextStatus,
      ...(routingChanged ? { status_changed_at: changedAt } : {}),
    }

    const { data, error: updateError } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', currentLead.id)
      .eq('workspace_id', currentLead.workspace_id!)
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
              <span className="lead-public-id">{currentLead.public_id}</span>
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
            {opsError && <div className="lead-save-error" role="alert">{opsError}</div>}

            <div className="lead-detail-grid">
              <LeadDetail label="Budget" value={currentLead.budget ? formatLeadBudget(currentLead.budget, currentLead.currency_code) : 'Not provided'} />
              <LeadDetail label="Public ID" value={currentLead.public_id} />
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

            <div className="lead-ops-grid">
              <section className="lead-drawer-section lead-ops-card">
                <div className="lead-ops-heading">
                  <div><span className="mini-label">INTERNAL CONTEXT</span><h3>Notes</h3></div>
                  <span className="lead-ops-count">{notes.length}</span>
                </div>
                <form className="lead-note-form" onSubmit={addNote}>
                  <textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Add a private note about this lead…" maxLength={5000} />
                  <button className="button secondary lead-ops-submit" type="submit" disabled={savingNote || !noteDraft.trim()}>{savingNote ? 'Adding…' : 'Add note'}</button>
                </form>
                {opsLoading ? (
                  <p className="lead-ops-empty">Loading notes…</p>
                ) : notes.length ? (
                  <div className="lead-notes-list">
                    {notes.map((note) => (
                      <article className="lead-note-item" key={note.id}>
                        <p>{note.body}</p>
                        <div className="lead-note-meta"><span>{note.public_id}</span><time>{formatActivityDate(note.created_at)}</time></div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="lead-ops-empty">No internal notes yet.</p>
                )}
              </section>

              <section className="lead-drawer-section lead-ops-card">
                <div className="lead-ops-heading">
                  <div><span className="mini-label">FOLLOW-UP</span><h3>Tasks</h3></div>
                  <span className="lead-ops-count">{tasks.filter((task) => task.status === 'open').length}</span>
                </div>
                <form className="lead-task-form" onSubmit={addTask}>
                  <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="e.g. Call about proposal" maxLength={240} />
                  <div className="lead-task-form-row">
                    <input type="datetime-local" value={taskDueAt} onChange={(event) => setTaskDueAt(event.target.value)} aria-label="Task due date" />
                    <select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as 'low' | 'medium' | 'high')} aria-label="Task priority">
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                  <button className="button secondary lead-ops-submit" type="submit" disabled={savingTask || !taskTitle.trim()}>{savingTask ? 'Creating…' : 'Create task'}</button>
                </form>
                {opsLoading ? (
                  <p className="lead-ops-empty">Loading tasks…</p>
                ) : tasks.length ? (
                  <div className="lead-tasks-list">
                    {tasks.map((task) => (
                      <article className={`lead-task-item ${task.status === 'done' ? 'done' : ''}`} key={task.id}>
                        <button className={`lead-task-toggle ${task.status === 'done' ? 'done' : ''}`} type="button" onClick={() => void toggleTask(task)} aria-label={task.status === 'done' ? 'Reopen task' : 'Complete task'}>{task.status === 'done' ? '✓' : ''}</button>
                        <div className="lead-task-copy">
                          <strong>{task.title}</strong>
                          <div className="lead-task-meta">
                            <span className={`lead-task-priority ${task.priority}`}>{task.priority}</span>
                            <time>{task.due_at ? `Due ${formatActivityDate(task.due_at)}` : 'No due date'}</time>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="lead-ops-empty">No follow-up tasks yet.</p>
                )}
              </section>
            </div>

            <section className="lead-drawer-section lead-activity-section">
              <div className="lead-activity-heading">
                <div><span className="mini-label">AUDIT TRAIL</span><h3>Activity timeline</h3><p>Pipeline moves, notes and task changes are recorded server-side.</p></div>
                <span className="lead-ops-count">{activities.length}</span>
              </div>
              {opsLoading ? (
                <p className="lead-activity-empty">Loading activity…</p>
              ) : activities.length ? (
                <div className="lead-activity-list">
                  {activities.map((activity) => (
                    <article className="lead-activity-item" key={activity.id}>
                      <span className={`lead-activity-icon ${activity.activity_type}`}>{activityIcon(activity.activity_type)}</span>
                      <div className="lead-activity-copy"><strong>{activity.title}</strong><span>{activityDetail(activity)}</span></div>
                      <time>{formatActivityDate(activity.occurred_at)}</time>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="lead-activity-empty">No operational activity has been logged yet.</p>
              )}
            </section>

            <section className="lead-drawer-section routing-history-section">
              <div className="routing-history-heading">
                <div><span className="mini-label">ROUTING AUDIT</span><h3>AI routing history</h3></div>
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
                      <time>{formatActivityDate(item.changed_at)}</time>
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
              <p>Contact and budget fields can be corrected. Changing routing status requests the matching n8n follow-up path.</p>
            </div>

            <div className="lead-edit-grid">
              <label><span>Name</span><input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} /></label>
              <label><span>Email</span><input type="email" value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} /></label>
              <label><span>Budget · USD workspace standard</span><input value={editForm.budget} onChange={(event) => setEditForm({ ...editForm, budget: event.target.value })} /></label>
              <label><span>Currency</span><input value={currentLead.currency_code || 'USD'} disabled /></label>
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
