import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import '../tasks.css'
import { useWorkspace } from '../workspace-context'

type Lead = Database['public']['Tables']['leads']['Row']
type Task = Database['public']['Tables']['lead_tasks']['Row']
type Filter = 'today' | 'overdue' | 'upcoming' | 'all' | 'done'

type Props = {
  onOpenLead: (lead: Lead) => void
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfToday() {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

function dueTime(task: Task) {
  if (!task.due_at) return null
  const time = new Date(task.due_at).getTime()
  return Number.isFinite(time) ? time : null
}

function sortTasks(rows: Task[]) {
  const priorityWeight = { high: 0, medium: 1, low: 2 }
  return [...rows].sort((a, b) => {
    const aDue = dueTime(a) ?? Number.MAX_SAFE_INTEGER
    const bDue = dueTime(b) ?? Number.MAX_SAFE_INTEGER
    if (aDue !== bDue) return aDue - bDue
    if (priorityWeight[a.priority] !== priorityWeight[b.priority]) return priorityWeight[a.priority] - priorityWeight[b.priority]
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })
}

function formatDue(task: Task) {
  if (!task.due_at) return 'No due date'
  const due = new Date(task.due_at)
  const todayStart = startOfToday().getTime()
  const todayEnd = endOfToday().getTime()
  const dueMs = due.getTime()

  if (dueMs >= todayStart && dueMs <= todayEnd) {
    return `Today · ${due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  }

  return due.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function TasksPage({ onOpenLead }: Props) {
  const { activeWorkspace } = useWorkspace()
  const [tasks, setTasks] = useState<Task[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [filter, setFilter] = useState<Filter>('today')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const load = useCallback(async (background = false) => {
    if (!supabase) {
      setError('Supabase is not configured.')
      setLoading(false)
      return
    }

    if (background) setRefreshing(true)
    else setLoading(true)
    setError(null)

    const [taskResult, leadResult] = await Promise.all([
      supabase.from('lead_tasks').select('*').eq('workspace_id', activeWorkspace.workspaceId).order('created_at', { ascending: false }),
      supabase.from('leads').select('*').eq('workspace_id', activeWorkspace.workspaceId).is('archived_at', null),
    ])

    if (taskResult.error || leadResult.error) {
      setError(taskResult.error?.message || leadResult.error?.message || 'Could not load tasks.')
    } else {
      setTasks((taskResult.data || []) as Task[])
      setLeads((leadResult.data || []) as Lead[])
    }

    setLoading(false)
    setRefreshing(false)
  }, [activeWorkspace.workspaceId])

  useEffect(() => { void load() }, [load])

  const leadById = useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads])
  const now = Date.now()
  const todayStart = startOfToday().getTime()
  const todayEnd = endOfToday().getTime()

  const counts = useMemo(() => {
    const open = tasks.filter((task) => task.status === 'open')
    return {
      today: open.filter((task) => {
        const due = dueTime(task)
        return due !== null && due >= todayStart && due <= todayEnd
      }).length,
      overdue: open.filter((task) => {
        const due = dueTime(task)
        return due !== null && due < todayStart
      }).length,
      upcoming: open.filter((task) => {
        const due = dueTime(task)
        return due !== null && due > todayEnd
      }).length,
      all: open.length,
      done: tasks.filter((task) => task.status === 'done').length,
    }
  }, [tasks, todayStart, todayEnd])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return sortTasks(tasks.filter((task) => {
      const due = dueTime(task)
      if (filter === 'today' && !(task.status === 'open' && due !== null && due >= todayStart && due <= todayEnd)) return false
      if (filter === 'overdue' && !(task.status === 'open' && due !== null && due < todayStart)) return false
      if (filter === 'upcoming' && !(task.status === 'open' && due !== null && due > todayEnd)) return false
      if (filter === 'all' && task.status !== 'open') return false
      if (filter === 'done' && task.status !== 'done') return false
      if (!needle) return true
      const lead = leadById.get(task.lead_id)
      return [task.title, task.description, task.priority, lead?.name, lead?.email, lead?.public_id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    }))
  }, [tasks, filter, query, todayStart, todayEnd, leadById])

  async function toggleTask(task: Task) {
    if (!supabase || updatingId) return
    setUpdatingId(task.id)
    setError(null)
    const complete = task.status !== 'done'
    const nowIso = new Date().toISOString()
    const { data, error: updateError } = await supabase
      .from('lead_tasks')
      .update({
        status: complete ? 'done' : 'open',
        completed_at: complete ? nowIso : null,
        updated_at: nowIso,
      })
      .eq('id', task.id)
      .eq('workspace_id', activeWorkspace.workspaceId)
      .select('*')
      .single()

    if (updateError || !data) {
      setError(updateError?.message || 'Could not update task.')
    } else {
      const updated = data as Task
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item))
    }
    setUpdatingId(null)
  }

  return (
    <>
      <section className="page-heading tasks-heading">
        <div>
          <div className="eyebrow">DAILY SALES EXECUTION</div>
          <h1>Tasks</h1>
          <p>Your action queue across every lead. Start with overdue work, then clear today.</p>
        </div>
        <button className="button primary" type="button" onClick={() => void load(true)} disabled={refreshing}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</button>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <section className="task-focus-strip" aria-label="Task focus counts">
        {(['today', 'overdue', 'upcoming', 'all', 'done'] as Filter[]).map((item) => (
          <button key={item} type="button" className={`task-focus ${filter === item ? 'active' : ''}`} onClick={() => setFilter(item)}>
            <span>{item === 'all' ? 'All open' : item[0].toUpperCase() + item.slice(1)}</span>
            <strong>{loading ? '—' : counts[item]}</strong>
          </button>
        ))}
      </section>

      <section className="panel task-inbox-panel">
        <div className="task-inbox-toolbar">
          <div>
            <span className="mini-label">FOCUS QUEUE</span>
            <h2>{filter === 'all' ? 'All open tasks' : filter[0].toUpperCase() + filter.slice(1)}</h2>
          </div>
          <div className="tasks-search">
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search task, lead or email…" aria-label="Search tasks" />
          </div>
        </div>

        <div className="task-list">
          {visible.map((task) => {
            const lead = leadById.get(task.lead_id)
            const due = dueTime(task)
            const overdue = task.status === 'open' && due !== null && due < now
            return (
              <article className={`task-row ${task.status === 'done' ? 'done' : ''} ${overdue ? 'overdue' : ''}`} key={task.id}>
                <button className={`task-check ${task.status === 'done' ? 'done' : ''}`} type="button" disabled={updatingId === task.id} onClick={() => void toggleTask(task)} aria-label={task.status === 'done' ? 'Reopen task' : 'Complete task'}>{task.status === 'done' ? '✓' : ''}</button>
                <div className="task-main">
                  <div className="task-title-line"><strong>{task.title}</strong><span className={`task-priority ${task.priority}`}>{task.priority}</span></div>
                  <div className="task-lead-line">
                    {lead ? <button type="button" onClick={() => onOpenLead(lead)}>{lead.name || 'Unnamed lead'} · {lead.public_id}</button> : <span>Lead unavailable</span>}
                    {lead?.email && <small>{lead.email}</small>}
                  </div>
                </div>
                <div className="task-due">
                  <strong className={overdue ? 'is-overdue' : ''}>{overdue ? 'Overdue' : formatDue(task)}</strong>
                  {overdue && task.due_at && <small>{formatDue(task)}</small>}
                </div>
                <span className="task-public-id">{task.public_id}</span>
              </article>
            )
          })}
          {!loading && visible.length === 0 && <div className="tasks-empty"><strong>Nothing in this queue.</strong><span>{filter === 'today' ? 'You have no tasks due today.' : 'Try another task view or clear the search.'}</span></div>}
          {loading && <div className="tasks-empty"><strong>Loading task inbox…</strong></div>}
        </div>
      </section>
    </>
  )
}
