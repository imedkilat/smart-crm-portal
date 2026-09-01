import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatLeadBudget, parseBudget } from '../lib/currency'
import type { Database } from '../types/database'
import '../pipeline.css'
import { useWorkspace } from '../workspace-context'

type Lead = Database['public']['Tables']['leads']['Row']
type Pipeline = Database['public']['Tables']['pipelines']['Row']
type Stage = Database['public']['Tables']['pipeline_stages']['Row']
type Task = Database['public']['Tables']['lead_tasks']['Row']

type Props = {
  onOpenLead: (lead: Lead) => void
  onLeadUpdated?: (lead: Lead) => void
}

function statusValue(lead: Lead) {
  return lead.routing_status || lead.category || 'Unclassified'
}

function classificationClass(value: string | null) {
  const normalized = (value || '').toLowerCase()
  if (normalized === 'hot') return 'hot'
  if (normalized === 'warm') return 'warm'
  return 'cold'
}

function moneyTotal(leads: Lead[]) {
  return leads.reduce((sum, lead) => sum + parseBudget(lead.budget), 0)
}

function formatUsd(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

export default function PipelinePage({ onOpenLead, onLeadUpdated }: Props) {
  const { activeWorkspace } = useWorkspace()
  const [pipeline, setPipeline] = useState<Pipeline | null>(null)
  const [stages, setStages] = useState<Stage[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draggingLeadId, setDraggingLeadId] = useState<number | null>(null)
  const [movingLeadId, setMovingLeadId] = useState<number | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [newStageType, setNewStageType] = useState<'open' | 'won' | 'lost'>('open')
  const [stageDrafts, setStageDrafts] = useState<Record<string, string>>({})
  const [savingStageId, setSavingStageId] = useState<string | null>(null)

  const loadPipeline = useCallback(async (background = false) => {
    if (!supabase) {
      setError('Supabase is not configured.')
      setLoading(false)
      return
    }

    if (background) setRefreshing(true)
    else setLoading(true)
    setError(null)

    const { data: pipelineData, error: pipelineError } = await supabase
      .from('pipelines')
      .select('*')
      .eq('workspace_id', activeWorkspace.workspaceId)
      .eq('is_default', true)
      .limit(1)
      .maybeSingle()

    if (pipelineError || !pipelineData) {
      setError(pipelineError?.message || 'No default sales pipeline is configured for this workspace.')
      setLoading(false)
      setRefreshing(false)
      return
    }

    const activePipeline = pipelineData as Pipeline
    setPipeline(activePipeline)

    const [stageResult, leadResult, taskResult] = await Promise.all([
      supabase.from('pipeline_stages').select('*').eq('workspace_id', activeWorkspace.workspaceId).eq('pipeline_id', activePipeline.id).order('position', { ascending: true }),
      supabase.from('leads').select('*').eq('workspace_id', activePipeline.workspace_id).is('archived_at', null).order('created_at', { ascending: false }),
      supabase.from('lead_tasks').select('*').eq('workspace_id', activePipeline.workspace_id).eq('status', 'open').order('due_at', { ascending: true }),
    ])

    if (stageResult.error || leadResult.error || taskResult.error) {
      setError(stageResult.error?.message || leadResult.error?.message || taskResult.error?.message || 'Could not load pipeline.')
    } else {
      const stageRows = (stageResult.data || []) as Stage[]
      setStages(stageRows)
      setLeads((leadResult.data || []) as Lead[])
      setTasks((taskResult.data || []) as Task[])
      setStageDrafts(Object.fromEntries(stageRows.map((stage) => [stage.id, stage.name])))
    }

    setLoading(false)
    setRefreshing(false)
  }, [activeWorkspace.workspaceId])

  useEffect(() => { void loadPipeline() }, [loadPipeline])

  const tasksByLead = useMemo(() => {
    const map = new Map<number, Task[]>()
    tasks.forEach((task) => {
      const current = map.get(task.lead_id) || []
      current.push(task)
      map.set(task.lead_id, current)
    })
    return map
  }, [tasks])

  const stageLeads = useMemo(() => {
    const map = new Map<string, Lead[]>()
    stages.forEach((stage) => map.set(stage.id, []))
    leads.forEach((lead) => {
      if (!lead.pipeline_stage_id) return
      const current = map.get(lead.pipeline_stage_id)
      if (current) current.push(lead)
    })
    return map
  }, [leads, stages])

  const unstaged = useMemo(() => leads.filter((lead) => !lead.pipeline_stage_id), [leads])
  const wonStageIds = useMemo(() => new Set(stages.filter((stage) => stage.stage_type === 'won').map((stage) => stage.id)), [stages])
  const lostStageIds = useMemo(() => new Set(stages.filter((stage) => stage.stage_type === 'lost').map((stage) => stage.id)), [stages])
  const openLeads = leads.filter((lead) => lead.pipeline_stage_id && !wonStageIds.has(lead.pipeline_stage_id) && !lostStageIds.has(lead.pipeline_stage_id))
  const wonLeads = leads.filter((lead) => lead.pipeline_stage_id && wonStageIds.has(lead.pipeline_stage_id))

  async function moveLead(lead: Lead, stageId: string) {
    if (!supabase || movingLeadId === lead.id || lead.pipeline_stage_id === stageId) return
    const previousStageId = lead.pipeline_stage_id
    const optimistic = { ...lead, pipeline_stage_id: stageId }

    setMovingLeadId(lead.id)
    setError(null)
    setLeads((current) => current.map((item) => item.id === lead.id ? optimistic : item))

    const { data, error: moveError } = await supabase
      .from('leads')
      .update({ pipeline_stage_id: stageId })
      .eq('id', lead.id)
      .eq('workspace_id', activeWorkspace.workspaceId)
      .select('*')
      .single()

    if (moveError || !data) {
      setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, pipeline_stage_id: previousStageId } : item))
      setError(moveError?.message || 'Could not move this lead.')
    } else {
      const updated = data as Lead
      setLeads((current) => current.map((item) => item.id === lead.id ? updated : item))
      onLeadUpdated?.(updated)
    }
    setMovingLeadId(null)
  }

  function dropLead(stageId: string) {
    if (!draggingLeadId) return
    const lead = leads.find((item) => item.id === draggingLeadId)
    setDraggingLeadId(null)
    if (lead) void moveLead(lead, stageId)
  }

  async function addStage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !pipeline) return
    const name = newStageName.trim()
    if (!name) return

    setError(null)
    const nextPosition = Math.max(0, ...stages.map((stage) => stage.position)) + 10
    const { error: addError } = await supabase.from('pipeline_stages').insert({
      pipeline_id: pipeline.id,
      workspace_id: pipeline.workspace_id,
      name,
      position: nextPosition,
      stage_type: newStageType,
    })

    if (addError) {
      setError(addError.message)
      return
    }

    setNewStageName('')
    setNewStageType('open')
    await loadPipeline(true)
  }

  async function saveStageName(stage: Stage) {
    if (!supabase) return
    const nextName = (stageDrafts[stage.id] || '').trim()
    if (!nextName || nextName === stage.name) return

    setSavingStageId(stage.id)
    setError(null)
    const { error: updateError } = await supabase.from('pipeline_stages').update({ name: nextName }).eq('id', stage.id).eq('workspace_id', activeWorkspace.workspaceId)
    if (updateError) setError(updateError.message)
    else setStages((current) => current.map((item) => item.id === stage.id ? { ...item, name: nextName } : item))
    setSavingStageId(null)
  }

  async function deleteStage(stage: Stage) {
    if (!supabase) return
    const occupied = stageLeads.get(stage.id)?.length || 0
    if (occupied) {
      setError(`Move the ${occupied} lead${occupied === 1 ? '' : 's'} out of ${stage.name} before deleting this stage.`)
      return
    }
    if (!window.confirm(`Delete the “${stage.name}” stage?`)) return

    const { error: deleteError } = await supabase.from('pipeline_stages').delete().eq('id', stage.id).eq('workspace_id', activeWorkspace.workspaceId)
    if (deleteError) setError(deleteError.message)
    else await loadPipeline(true)
  }

  return (
    <>
      <section className="page-heading pipeline-heading">
        <div>
          <div className="eyebrow">SALES OPERATIONS</div>
          <h1>{pipeline?.name || 'Sales Pipeline'}</h1>
          <p>Move opportunities through your commercial process. AI quality and sales stage are intentionally separate signals.</p>
        </div>
        <div className="heading-actions">
          <button className="button secondary" type="button" onClick={() => setManageOpen((value) => !value)}>{manageOpen ? 'Close stage manager' : 'Manage stages'}</button>
          <button className="button primary" type="button" onClick={() => void loadPipeline(true)} disabled={refreshing}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</button>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <section className="pipeline-kpis" aria-label="Sales pipeline metrics">
        <article><span>Open opportunities</span><strong>{loading ? '—' : openLeads.length}</strong><small>Active commercial conversations</small></article>
        <article><span>Open pipeline value</span><strong>{loading ? '—' : formatUsd(moneyTotal(openLeads))}</strong><small>USD, excluding won and lost</small></article>
        <article><span>Won value</span><strong>{loading ? '—' : formatUsd(moneyTotal(wonLeads))}</strong><small>Closed-won opportunity value</small></article>
        <article><span>Open follow-ups</span><strong>{loading ? '—' : tasks.length}</strong><small>Tasks attached to active leads</small></article>
      </section>

      {manageOpen && pipeline && (
        <section className="panel pipeline-manager">
          <div className="pipeline-manager-heading">
            <div><span className="mini-label">WORKSPACE CONFIGURATION</span><h2>Pipeline stages</h2><p>Add and rename stages without changing AI Hot / Warm / Cold classification.</p></div>
          </div>
          <div className="stage-manager-list">
            {stages.map((stage) => (
              <div className="stage-manager-row" key={stage.id}>
                <span className={`stage-type-dot ${stage.stage_type}`} />
                <input value={stageDrafts[stage.id] ?? stage.name} onChange={(event) => setStageDrafts((current) => ({ ...current, [stage.id]: event.target.value }))} />
                <span className={`stage-type-badge ${stage.stage_type}`}>{stage.stage_type}</span>
                <button type="button" className="button tertiary" onClick={() => void saveStageName(stage)} disabled={savingStageId === stage.id}>{savingStageId === stage.id ? 'Saving…' : 'Save'}</button>
                <button type="button" className="stage-delete-button" onClick={() => void deleteStage(stage)}>Delete</button>
              </div>
            ))}
          </div>
          <form className="stage-add-form" onSubmit={addStage}>
            <input value={newStageName} onChange={(event) => setNewStageName(event.target.value)} placeholder="New stage name" maxLength={80} />
            <select value={newStageType} onChange={(event) => setNewStageType(event.target.value as 'open' | 'won' | 'lost')}>
              <option value="open">Open stage</option>
              <option value="won">Won outcome</option>
              <option value="lost">Lost outcome</option>
            </select>
            <button className="button primary" type="submit">+ Add stage</button>
          </form>
        </section>
      )}

      {unstaged.length > 0 && (
        <div className="pipeline-warning">{unstaged.length} lead{unstaged.length === 1 ? '' : 's'} currently have no sales stage. Refresh or move them into a stage from the lead record.</div>
      )}

      <section className={`pipeline-board ${loading ? 'is-loading' : ''}`} aria-label="Sales pipeline board">
        {stages.map((stage) => {
          const rows = stageLeads.get(stage.id) || []
          const stageValue = moneyTotal(rows)
          return (
            <article
              className={`pipeline-column ${stage.stage_type}`}
              key={stage.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => dropLead(stage.id)}
            >
              <header className="pipeline-column-header">
                <div><span className={`stage-type-dot ${stage.stage_type}`} /><strong>{stage.name}</strong><em>{rows.length}</em></div>
                <small>{formatUsd(stageValue)}</small>
              </header>

              <div className="pipeline-card-list">
                {rows.map((lead) => {
                  const leadTasks = tasksByLead.get(lead.id) || []
                  const nextTask = leadTasks.find((task) => task.due_at) || leadTasks[0]
                  return (
                    <article
                      className={`pipeline-card ${draggingLeadId === lead.id ? 'is-dragging' : ''}`}
                      key={lead.id}
                      draggable
                      onDragStart={() => setDraggingLeadId(lead.id)}
                      onDragEnd={() => setDraggingLeadId(null)}
                      onClick={() => onOpenLead(lead)}
                    >
                      <div className="pipeline-card-top">
                        <span className={`category-pill ${classificationClass(statusValue(lead))}`}><i />{statusValue(lead)}</span>
                        <span className="pipeline-card-id">{lead.public_id}</span>
                      </div>
                      <h3>{lead.name || 'Unnamed lead'}</h3>
                      <p>{lead.email || 'No email address'}</p>
                      <strong className="pipeline-card-value">{formatLeadBudget(lead.budget, 'USD')}</strong>
                      <div className="pipeline-card-meta">
                        <span>{lead.intent || 'No intent'}</span>
                        <span>{lead.source || 'Unknown source'}</span>
                      </div>
                      {nextTask && (
                        <div className={`pipeline-next-task ${nextTask.priority}`}>
                          <span>↳ {nextTask.title}</span>
                          <small>{nextTask.due_at ? new Date(nextTask.due_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No due date'}</small>
                        </div>
                      )}
                      <label className="pipeline-stage-select" onClick={(event) => event.stopPropagation()}>
                        <span>Move to</span>
                        <select value={lead.pipeline_stage_id || ''} disabled={movingLeadId === lead.id} onChange={(event) => void moveLead(lead, event.target.value)}>
                          {stages.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                        </select>
                      </label>
                    </article>
                  )
                })}
                {!loading && rows.length === 0 && <div className="pipeline-empty">Drop a lead here</div>}
              </div>
            </article>
          )
        })}
      </section>
    </>
  )
}
