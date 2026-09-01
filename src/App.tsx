import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { budgetTotalsByCurrency, formatCurrencyTotals, formatLeadBudget, formatMoney, parseBudget } from './lib/currency'
import { useAppRoute, type AppPage } from './lib/appRoutes'
import type { Database } from './types/database'
import GlobalSearch from './components/GlobalSearch'
import LeadsPage from './pages/LeadsPage'
import PipelinePage from './pages/PipelinePage'
import TasksPage from './pages/TasksPage'
import AddLeadPage from './pages/AddLeadPage'
import CopilotPage from './pages/CopilotPage'
import ReportsPage from './pages/ReportsPage'
import AutomationPage from './pages/AutomationPage'
import SettingsPage from './pages/SettingsPage'
import WorkspaceSwitcher from './components/WorkspaceSwitcher'
import { useWorkspace } from './workspace-context'
import './analytics.css'
import './crm-pages.css'
import './system-pages.css'
import './leads-new.css'

type Lead = Database['public']['Tables']['leads']['Row']
type WeeklySummary = Database['public']['Tables']['weekly_summary']['Row']
type Page = AppPage
type Metrics = {
  total: number
  hot: number
  warm: number
  cold: number
  pipelineByCurrency: Map<string, number>
}

type NavItem = {
  id: Page
  label: string
  icon: string
}

type AccountIdentity = {
  displayName: string
  greetingName: string | null
  roleLabel: string
}

const NEW_LEAD_WINDOW_MS = 30 * 60 * 1000

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
  { id: 'pipeline', label: 'Pipeline', icon: '▥' },
  { id: 'tasks', label: 'Tasks', icon: '✓' },
  { id: 'leads', label: 'Leads', icon: '◌' },
  { id: 'add', label: 'Add Lead', icon: '+' },
  { id: 'copilot', label: 'AI Brain', icon: '✦' },
  { id: 'automation', label: 'Automation', icon: '⌁' },
  { id: 'analytics', label: 'Analytics', icon: '↗' },
  { id: 'reports', label: 'Reports', icon: '▤' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

const workflow = [
  ['01', 'Lead intake', 'Forms, Excel uploads and manual capture'],
  ['02', 'AI classification', 'Intent, Hot / Warm / Cold and summary'],
  ['03', 'Storage', 'Structured records synced to Supabase'],
  ['04', 'Follow-up', 'Automated outreach based on routing priority'],
  ['05', 'Intelligence', 'Weekly trends, insights and reports'],
]

function initials(name: string | null) {
  if (!name) return '—'
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function preferredAccountName(metadata: Record<string, unknown> | undefined) {
  for (const key of ['full_name', 'name', 'display_name']) {
    const value = metadata?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function accountFirstName(name: string | null) {
  if (!name) return null
  return name.trim().split(/\s+/)[0] || null
}

function formatRole(role: string | null | undefined) {
  if (!role) return 'Workspace member'
  return role
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
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

function percent(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0
}

function sortNewest(rows: Lead[]) {
  return [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

function leadCreatedAt(lead: Lead) {
  const timestamp = new Date(lead.created_at).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function isNewLead(lead: Lead, now = Date.now()) {
  const createdAt = leadCreatedAt(lead)
  if (!createdAt) return false
  const age = now - createdAt
  return age >= 0 && age <= NEW_LEAD_WINDOW_MS
}

function freshnessLabel(lead: Lead, now = Date.now()) {
  const age = Math.max(0, now - leadCreatedAt(lead))
  const minutes = Math.floor(age / 60000)
  if (minutes <= 1) return 'Just added'
  return `${minutes}m ago`
}

export default function App() {
  const { activeWorkspace } = useWorkspace()
  const { route, navigate, navigateLead } = useAppRoute()
  const page = route.page
  const [leads, setLeads] = useState<Lead[]>([])
  const [weeklySummary, setWeeklySummary] = useState<WeeklySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accountIdentity, setAccountIdentity] = useState<AccountIdentity>({
    displayName: 'Signed-in user',
    greetingName: null,
    roleLabel: 'Workspace member',
  })

  useEffect(() => {
    const titles: Record<Page, string> = {
      dashboard: 'Dashboard',
      pipeline: 'Sales Pipeline',
      tasks: 'Tasks',
      leads: route.leadPublicId ? 'Lead Profile' : 'Leads',
      add: 'Add Lead',
      copilot: 'AI Brain',
      automation: 'Automation',
      analytics: 'Analytics',
      reports: 'Reports',
      settings: 'Settings',
    }
    document.title = `${titles[page]} · Smart CRM`
  }, [page, route.leadPublicId])

  useEffect(() => {
    let active = true

    async function loadAccountIdentity() {
      if (!supabase) return

      const { data: userResult, error: userError } = await supabase.auth.getUser()
      const user = userResult.user
      if (!active || userError || !user) return

      const preferredName = preferredAccountName(user.user_metadata)
      const displayName = preferredName || user.email || 'Signed-in user'
      if (!active) return
      setAccountIdentity({
        displayName,
        greetingName: accountFirstName(preferredName),
        roleLabel: formatRole(activeWorkspace.role),
      })
    }

    void loadAccountIdentity()
    return () => {
      active = false
    }
  }, [activeWorkspace.role])

  useEffect(() => {
    if (page !== 'dashboard' && page !== 'analytics') return

    let active = true

    async function loadDashboard() {
      if (!supabase) {
        setError('Supabase is not configured.')
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      const [leadsResult, weeklyResult] = await Promise.all([
        supabase.from('leads').select('*').eq('workspace_id', activeWorkspace.workspaceId).is('archived_at', null).order('created_at', { ascending: false }),
        supabase.from('weekly_summary').select('*').eq('workspace_id', activeWorkspace.workspaceId).order('created_at', { ascending: false }).limit(1),
      ])

      if (!active) return

      if (leadsResult.error) {
        setError(leadsResult.error.message)
      } else {
        setLeads((leadsResult.data || []) as Lead[])
      }

      if (!weeklyResult.error) {
        setWeeklySummary((weeklyResult.data?.[0] as WeeklySummary | undefined) || null)
      }

      setLoading(false)
    }

    void loadDashboard()
    return () => {
      active = false
    }
  }, [activeWorkspace.workspaceId, page])

  const handleLeadsLoaded = useCallback((rows: Lead[]) => {
    setLeads(sortNewest(rows.filter((lead) => lead.workspace_id === activeWorkspace.workspaceId && !lead.archived_at)))
  }, [activeWorkspace.workspaceId])

  const handleLeadUpdated = useCallback((updatedLead: Lead) => {
    if (updatedLead.workspace_id !== activeWorkspace.workspaceId) return
    setLeads((current) => {
      if (updatedLead.archived_at) {
        return current.filter((lead) => lead.id !== updatedLead.id)
      }

      const exists = current.some((lead) => lead.id === updatedLead.id)
      const next = exists
        ? current.map((lead) => lead.id === updatedLead.id ? updatedLead : lead)
        : [...current, updatedLead]

      return sortNewest(next)
    })
  }, [activeWorkspace.workspaceId])

  const metrics = useMemo<Metrics>(() => {
    const total = leads.length
    const hot = leads.filter((lead) => statusValue(lead).toLowerCase() === 'hot').length
    const warm = leads.filter((lead) => statusValue(lead).toLowerCase() === 'warm').length
    const cold = leads.filter((lead) => statusValue(lead).toLowerCase() === 'cold').length
    const pipelineByCurrency = budgetTotalsByCurrency(leads)

    return { total, hot, warm, cold, pipelineByCurrency }
  }, [leads])

  const distribution = [
    { label: 'Hot', count: metrics.hot, className: 'hot' },
    { label: 'Warm', count: metrics.warm, className: 'warm' },
    { label: 'Cold', count: metrics.cold, className: 'cold' },
  ]

  const recentLeads = leads.slice(0, 6)

  function openLead(lead: Lead) {
    navigateLead(lead.public_id || lead.id)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <strong>Smart CRM</strong>
            <span>Automation workspace</span>
          </div>
        </div>

        <WorkspaceSwitcher onSwitch={() => navigate('dashboard')} />

        <nav className="nav-list" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
              type="button"
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
          <button
            className="nav-item"
            onClick={() => window.location.assign('/quotes')}
            type="button"
          >
            <span className="nav-icon">◇</span>
            Quotes
          </button>
        </nav>

        <div className="sidebar-status">
          <span className="status-kicker">AUTOMATION</span>
          <div className="live-row">
            <span className="live-dot" />
            <span>Supabase connected</span>
          </div>
          <p>commercial foundation · live data</p>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <GlobalSearch onLeadUpdated={handleLeadUpdated} />
          <div className="topbar-meta">
            <span className="lead-count">{metrics.total} leads</span>
            <div className="owner-avatar">{initials(accountIdentity.displayName)}</div>
            <div className="owner-copy">
              <strong>{accountIdentity.displayName}</strong>
              <span>{accountIdentity.roleLabel}</span>
            </div>
          </div>
        </header>

        <main className="content" key={activeWorkspace.workspaceId}>
          {page === 'dashboard' && (
            <DashboardPage
              loading={loading}
              error={error}
              metrics={metrics}
              distribution={distribution}
              weeklySummary={weeklySummary}
              recentLeads={recentLeads}
              greetingName={accountIdentity.greetingName}
              setPage={navigate}
              onOpenLead={openLead}
            />
          )}

          {page === 'pipeline' && (
            <PipelinePage onOpenLead={openLead} onLeadUpdated={handleLeadUpdated} />
          )}

          {page === 'tasks' && (
            <TasksPage onOpenLead={openLead} />
          )}

          {page === 'leads' && (
            <LeadsPage
              onLoaded={handleLeadsLoaded}
              onAddLead={() => navigate('add')}
              selectedPublicId={route.leadPublicId}
              onOpenLead={openLead}
              onCloseLead={() => navigate('leads')}
            />
          )}

          {page === 'add' && (
            <AddLeadPage onCreated={() => navigate('leads')} />
          )}

          {page === 'copilot' && <CopilotPage />}

          {page === 'automation' && <AutomationPage onLeadUpdated={handleLeadUpdated} />}

          {page === 'analytics' && (
            <AnalyticsPage leads={leads} metrics={metrics} weeklySummary={weeklySummary} loading={loading} />
          )}

          {page === 'reports' && <ReportsPage />}

          {page === 'settings' && (
            <SettingsPage
              onOpenRunLog={() => navigate('automation')}
              onLeadRestored={handleLeadUpdated}
            />
          )}
        </main>
      </div>
    </div>
  )
}

function DashboardPage({
  loading,
  error,
  metrics,
  distribution,
  weeklySummary,
  recentLeads,
  greetingName,
  setPage,
  onOpenLead,
}: {
  loading: boolean
  error: string | null
  metrics: Metrics
  distribution: { label: string; count: number; className: string }[]
  weeklySummary: WeeklySummary | null
  recentLeads: Lead[]
  greetingName: string | null
  setPage: (page: Page) => void
  onOpenLead: (lead: Lead) => void
}) {
  const [freshnessNow, setFreshnessNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setFreshnessNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">SMART CRM · COMMERCIAL BUILD</div>
          <h1>{greetingName ? `Good morning, ${greetingName}` : 'Good morning'}</h1>
          <p>Here&apos;s what&apos;s happening with your lead pipeline.</p>
        </div>
        <div className="heading-actions">
          <button className="button secondary" type="button" onClick={() => setPage('copilot')}>
            Ask AI Brain
          </button>
          <button className="button secondary" type="button" onClick={() => setPage('pipeline')}>
            Open pipeline
          </button>
          <button className="button primary" type="button" onClick={() => setPage('add')}>
            + Add lead
          </button>
        </div>
      </section>

      {error && <div className="error-banner">Could not load CRM data: {error}</div>}

      <section className="kpi-grid" aria-label="Lead metrics">
        <MetricCard label="Total leads" value={loading ? '—' : String(metrics.total)} tone="blue" note="Active in Supabase" />
        <MetricCard label="Hot" value={loading ? '—' : String(metrics.hot)} tone="red" note="Hot routing priority" />
        <MetricCard label="Warm" value={loading ? '—' : String(metrics.warm)} tone="amber" note="Warm routing priority" />
        <MetricCard label="Cold" value={loading ? '—' : String(metrics.cold)} tone="cyan" note="Cold routing priority" />
        <MetricCard label="Lead budget value" value={loading ? '—' : formatCurrencyTotals(metrics.pipelineByCurrency)} tone="violet" note="Active lead budgets · USD" wide />
      </section>

      <section className="automation-card">
        <div className="automation-glow" />
        <div className="section-heading">
          <div>
            <div className="title-row">
              <h2>Automation pipeline</h2>
              <span className="health-pill"><span /> Production routing</span>
            </div>
            <p>Every lead moves through a structured automation flow before reporting.</p>
          </div>
          <button className="button tertiary" type="button" onClick={() => setPage('automation')}>View run log</button>
        </div>

        <div className="workflow-grid">
          {workflow.map(([step, title, description]) => (
            <div className="workflow-step" key={step}>
              <div className="step-topline">
                <span>STEP {step}</span>
                <span className="step-check">✓</span>
              </div>
              <strong>{title}</strong>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="insight-grid">
        <article className="panel insight-panel">
          <div className="section-heading compact">
            <div>
              <span className="mini-label">AI INTELLIGENCE</span>
              <h2>What the pipeline is telling you</h2>
            </div>
            <span className="spark-badge">✦</span>
          </div>
          <p className="insight-copy">
            {weeklySummary?.ai_summary ||
              'Your weekly AI summary will appear here as soon as the reporting workflow writes its next result.'}
          </p>
          <div className="insight-footer">
            <span>{weeklySummary?.period || 'Latest available summary'}</span>
            <button type="button" onClick={() => setPage('analytics')}>Open analytics →</button>
          </div>
        </article>

        <article className="panel distribution-panel">
          <div className="section-heading compact">
            <div>
              <span className="mini-label">AI LEAD QUALITY</span>
              <h2>Lead quality mix</h2>
            </div>
            <strong className="panel-total">{metrics.total}</strong>
          </div>
          <div className="distribution-list">
            {distribution.map((item) => {
              const pct = percent(item.count, metrics.total)
              return (
                <div className="distribution-row" key={item.label}>
                  <div className="distribution-meta">
                    <span><i className={item.className} /> {item.label}</span>
                    <strong>{item.count} · {pct}%</strong>
                  </div>
                  <div className="bar-track"><span className={item.className} style={{ width: `${pct}%` }} /></div>
                </div>
              )
            })}
          </div>
        </article>
      </section>

      <section className="panel recent-panel">
        <div className="section-heading compact">
          <div>
            <span className="mini-label">LIVE FROM SUPABASE</span>
            <h2>Recent leads</h2>
            <p>Click any lead to open its profile, edit operational details or change routing status.</p>
          </div>
          <button className="button tertiary" type="button" onClick={() => setPage('leads')}>View all</button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Intent</th>
                <th>Routing status</th>
                <th>Budget</th>
                <th>Source</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {recentLeads.map((lead) => {
                const routing = statusValue(lead)
                const newLead = isNewLead(lead, freshnessNow)
                return (
                  <tr
                    key={lead.id}
                    className={`lead-table-row ${newLead ? 'is-new-lead' : ''}`}
                    tabIndex={0}
                    onClick={() => onOpenLead(lead)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onOpenLead(lead)
                      }
                    }}
                    aria-label={`Open ${lead.name || 'lead'} profile`}
                  >
                    <td>
                      <div className="lead-cell">
                        <span className="avatar">{initials(lead.name)}</span>
                        <div>
                          <div className="lead-name-line">
                            <strong>{lead.name || 'Unnamed lead'}</strong>
                            {newLead && <span className="new-lead-badge"><i />New</span>}
                          </div>
                          <span>{lead.email || 'No email'} · {lead.public_id}</span>
                        </div>
                      </div>
                    </td>
                    <td>{lead.intent || '—'}</td>
                    <td><span className={`category-pill ${categoryClass(routing)}`}><i />{routing}</span></td>
                    <td>{formatLeadBudget(lead.budget, lead.currency_code)}</td>
                    <td>{lead.source || '—'}</td>
                    <td>
                      <div className="lead-added-cell">
                        <span>{new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        {newLead && <small>{freshnessLabel(lead, freshnessNow)}</small>}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!loading && recentLeads.length === 0 && (
                <tr><td className="empty-cell" colSpan={6}>No active leads yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function AnalyticsPage({
  leads,
  metrics,
  weeklySummary,
  loading,
}: {
  leads: Lead[]
  metrics: Metrics
  weeklySummary: WeeklySummary | null
  loading: boolean
}) {
  const sourceStats = useMemo(() => {
    const counts = new Map<string, number>()
    leads.forEach((lead) => {
      const source = lead.source?.trim() || 'Unknown'
      counts.set(source, (counts.get(source) || 0) + 1)
    })
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
  }, [leads])

  const intentStats = useMemo(() => {
    const counts = new Map<string, number>()
    leads.forEach((lead) => {
      const intent = lead.intent?.trim() || 'Unspecified'
      counts.set(intent, (counts.get(intent) || 0) + 1)
    })
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
  }, [leads])

  const trend = useMemo(() => {
    const counts = new Map<string, { date: Date; count: number }>()
    leads.forEach((lead) => {
      const date = new Date(lead.created_at)
      if (Number.isNaN(date.getTime())) return
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      const current = counts.get(key)
      counts.set(key, { date: new Date(date.getFullYear(), date.getMonth(), 1), count: (current?.count || 0) + 1 })
    })
    return [...counts.values()]
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(-6)
      .map((item) => ({
        label: item.date.toLocaleDateString('en-US', { month: 'short' }),
        count: item.count,
      }))
  }, [leads])

  const budgetStats = useMemo(() => {
    return ['hot', 'warm', 'cold'].map((category) => {
      const categoryLeads = leads.filter((lead) => statusValue(lead).toLowerCase() === category)
      const totals = budgetTotalsByCurrency(categoryLeads)
      const budgetCount = categoryLeads.filter((lead) => parseBudget(lead.budget) > 0).length
      return {
        label: category[0].toUpperCase() + category.slice(1),
        className: category,
        totals,
        budgetCount,
      }
    })
  }, [leads])

  const singleCurrencyCode = metrics.pipelineByCurrency.size === 1 ? [...metrics.pipelineByCurrency.keys()][0] : null
  const singleCurrencyPipeline = singleCurrencyCode ? metrics.pipelineByCurrency.get(singleCurrencyCode) || 0 : 0
  const budgetLeadCount = leads.filter((lead) => parseBudget(lead.budget) > 0).length
  const avgBudget = singleCurrencyCode && budgetLeadCount ? singleCurrencyPipeline / budgetLeadCount : 0
  const hotShare = percent(metrics.hot, metrics.total)
  const maxTrend = Math.max(...trend.map((item) => item.count), 1)
  const maxSource = Math.max(...sourceStats.map((item) => item.count), 1)
  const maxIntent = Math.max(...intentStats.map((item) => item.count), 1)
  const maxBudget = singleCurrencyCode
    ? Math.max(...budgetStats.map((item) => item.totals.get(singleCurrencyCode) || 0), 1)
    : 1
  const dominantSource = sourceStats[0]
  const dominantIntent = intentStats[0]

  return (
    <>
      <section className="page-heading analytics-heading">
        <div>
          <div className="eyebrow">LIVE PIPELINE INTELLIGENCE</div>
          <h1>Analytics</h1>
          <p>Lead routing, acquisition, intent and budget signals from your active Supabase data.</p>
        </div>
        <span className="analytics-live"><i /> Live data</span>
      </section>

      <section className="analytics-kpis">
        <AnalyticsMetric label="Hot routing share" value={loading ? '—' : `${hotShare}%`} note={`${metrics.hot} of ${metrics.total} leads`} accent="red" />
        <AnalyticsMetric
          label="Average lead budget"
          value={loading ? '—' : singleCurrencyCode ? formatMoney(avgBudget, singleCurrencyCode) : '—'}
          note={singleCurrencyCode ? `Across ${budgetLeadCount} budgeted leads · USD` : 'No USD budget data'}
          accent="violet"
        />
        <AnalyticsMetric label="Top source" value={loading ? '—' : dominantSource?.label || '—'} note={dominantSource ? `${dominantSource.count} leads captured` : 'No source data'} accent="blue" />
        <AnalyticsMetric label="Primary intent" value={loading ? '—' : dominantIntent?.label || '—'} note={dominantIntent ? `${percent(dominantIntent.count, metrics.total)}% of pipeline` : 'No intent data'} accent="amber" />
      </section>

      <section className="analytics-grid analytics-grid-top">
        <article className="panel analytics-panel quality-panel">
          <AnalyticsPanelHeader kicker="ROUTING PRIORITY" title="Pipeline distribution" detail={`${metrics.total} total leads`} />
          <div className="quality-layout">
            <div
              className="quality-donut"
              style={{
                background: `conic-gradient(#f04438 0 ${hotShare}%, #f79009 ${hotShare}% ${hotShare + percent(metrics.warm, metrics.total)}%, #38bdf8 ${hotShare + percent(metrics.warm, metrics.total)}% 100%)`,
              }}
            >
              <div><strong>{metrics.total}</strong><span>leads</span></div>
            </div>
            <div className="quality-legend">
              {[
                ['Hot', metrics.hot, 'hot'],
                ['Warm', metrics.warm, 'warm'],
                ['Cold', metrics.cold, 'cold'],
              ].map(([label, count, className]) => (
                <div className="quality-row" key={String(label)}>
                  <span><i className={String(className)} />{label}</span>
                  <strong>{count} <small>{percent(Number(count), metrics.total)}%</small></strong>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="panel analytics-panel trend-panel">
          <AnalyticsPanelHeader kicker="ACTIVITY" title="Lead arrival trend" detail="Last 6 active months" />
          <div className="trend-chart" aria-label="Lead arrival trend">
            {trend.length ? trend.map((item) => (
              <div className="trend-column" key={item.label}>
                <span className="trend-value">{item.count}</span>
                <div className="trend-track"><span style={{ height: `${Math.max(12, (item.count / maxTrend) * 100)}%` }} /></div>
                <small>{item.label}</small>
              </div>
            )) : <div className="analytics-empty">No dated lead activity yet.</div>}
          </div>
        </article>
      </section>

      <section className="analytics-grid">
        <article className="panel analytics-panel">
          <AnalyticsPanelHeader kicker="ACQUISITION" title="Lead sources" detail="Where leads entered the CRM" />
          <div className="rank-list">
            {sourceStats.map((item, index) => (
              <div className="rank-row" key={item.label}>
                <span className="rank-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="rank-content">
                  <div><strong>{item.label}</strong><span>{item.count} leads · {percent(item.count, metrics.total)}%</span></div>
                  <div className="rank-track"><span style={{ width: `${(item.count / maxSource) * 100}%` }} /></div>
                </div>
              </div>
            ))}
            {!sourceStats.length && <div className="analytics-empty">No source data yet.</div>}
          </div>
        </article>

        <article className="panel analytics-panel">
          <AnalyticsPanelHeader kicker="BUYER SIGNAL" title="Intent breakdown" detail="What leads are trying to do" />
          <div className="intent-list">
            {intentStats.map((item) => (
              <div className="intent-row" key={item.label}>
                <div className="intent-meta"><span>{item.label}</span><strong>{item.count} · {percent(item.count, metrics.total)}%</strong></div>
                <div className="intent-track"><span style={{ width: `${(item.count / maxIntent) * 100}%` }} /></div>
              </div>
            ))}
            {!intentStats.length && <div className="analytics-empty">No intent data yet.</div>}
          </div>
        </article>
      </section>

      <section className="analytics-grid analytics-grid-bottom">
        <article className="panel analytics-panel budget-panel">
          <AnalyticsPanelHeader kicker="PIPELINE VALUE" title="Budget by routing status" detail={formatCurrencyTotals(metrics.pipelineByCurrency)} />
          <div className="budget-bars">
            {budgetStats.map((item) => {
              const singleTotal = singleCurrencyCode ? item.totals.get(singleCurrencyCode) || 0 : 0
              const average = singleCurrencyCode && item.budgetCount ? singleTotal / item.budgetCount : 0
              return (
                <div className="budget-row" key={item.label}>
                  <div className="budget-copy">
                    <span><i className={item.className} />{item.label}</span>
                    <strong>{formatCurrencyTotals(item.totals)}</strong>
                    <small>{singleCurrencyCode ? `Avg ${formatMoney(average, singleCurrencyCode)}` : 'No USD budget data'}</small>
                  </div>
                  {singleCurrencyCode && (
                    <div className="budget-track"><span className={item.className} style={{ width: `${(singleTotal / maxBudget) * 100}%` }} /></div>
                  )}
                </div>
              )
            })}
          </div>
        </article>

        <article className="panel analytics-panel ai-analysis-panel">
          <div className="ai-analysis-top">
            <span className="spark-badge">✦</span>
            <div>
              <span className="mini-label">AI WEEKLY READOUT</span>
              <h2>Latest intelligence</h2>
            </div>
          </div>
          <p>{weeklySummary?.ai_summary || 'The next n8n weekly-summary run will write fresh AI commentary here.'}</p>
          <div className="ai-analysis-footer">
            <span>{weeklySummary?.period || 'No reporting period yet'}</span>
            <span>Supabase → Analytics</span>
          </div>
        </article>
      </section>
    </>
  )
}

function AnalyticsMetric({
  label,
  value,
  note,
  accent,
}: {
  label: string
  value: string
  note: string
  accent: 'red' | 'violet' | 'blue' | 'amber'
}) {
  return (
    <article className="analytics-metric">
      <span className={`analytics-accent ${accent}`} />
      <span className="analytics-metric-label">{label}</span>
      <strong title={value}>{value}</strong>
      <small>{note}</small>
    </article>
  )
}

function AnalyticsPanelHeader({ kicker, title, detail }: { kicker: string; title: string; detail: string }) {
  return (
    <div className="analytics-panel-heading">
      <div>
        <span className="mini-label">{kicker}</span>
        <h2>{title}</h2>
      </div>
      <span>{detail}</span>
    </div>
  )
}

function MetricCard({
  label,
  value,
  tone,
  note,
  wide = false,
}: {
  label: string
  value: string
  tone: 'blue' | 'red' | 'amber' | 'cyan' | 'violet'
  note: string
  wide?: boolean
}) {
  return (
    <article className={`metric-card ${wide ? 'wide' : ''}`}>
      <div className="metric-label"><span className={`metric-dot ${tone}`} />{label}</div>
      <strong>{value}</strong>
      <div className="metric-note"><span className="metric-chip">Live</span>{note}</div>
    </article>
  )
}
