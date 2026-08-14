import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import type { Database } from './types/database'
import './analytics.css'

type Lead = Database['public']['Tables']['leads']['Row']
type WeeklySummary = Database['public']['Tables']['weekly_summary']['Row']
type Page = 'dashboard' | 'leads' | 'add' | 'analytics' | 'reports' | 'settings'

type NavItem = {
  id: Page
  label: string
  icon: string
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
  { id: 'leads', label: 'Leads', icon: '◌' },
  { id: 'add', label: 'Add Lead', icon: '+' },
  { id: 'analytics', label: 'Analytics', icon: '↗' },
  { id: 'reports', label: 'Reports', icon: '▤' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

const workflow = [
  ['01', 'Lead intake', 'Forms, Excel uploads and manual capture'],
  ['02', 'AI classification', 'Intent, Hot / Warm / Cold and summary'],
  ['03', 'Storage', 'Structured records synced to Supabase'],
  ['04', 'Follow-up', 'Automated outreach based on lead quality'],
  ['05', 'Intelligence', 'Weekly trends, insights and reports'],
]

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

function initials(name: string | null) {
  if (!name) return '—'
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
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

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [leads, setLeads] = useState<Lead[]>([])
  const [weeklySummary, setWeeklySummary] = useState<WeeklySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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
        supabase.from('leads').select('*').order('created_at', { ascending: false }),
        supabase.from('weekly_summary').select('*').order('created_at', { ascending: false }).limit(1),
      ])

      if (!active) return

      if (leadsResult.error) {
        setError(leadsResult.error.message)
      } else {
        setLeads(leadsResult.data || [])
      }

      if (!weeklyResult.error) {
        setWeeklySummary(weeklyResult.data?.[0] || null)
      }

      setLoading(false)
    }

    loadDashboard()
    return () => {
      active = false
    }
  }, [])

  const metrics = useMemo(() => {
    const total = leads.length
    const hot = leads.filter((lead) => lead.category?.toLowerCase() === 'hot').length
    const warm = leads.filter((lead) => lead.category?.toLowerCase() === 'warm').length
    const cold = leads.filter((lead) => lead.category?.toLowerCase() === 'cold').length
    const pipeline = leads.reduce((sum, lead) => sum + parseBudget(lead.budget), 0)

    return { total, hot, warm, cold, pipeline }
  }, [leads])

  const distribution = [
    { label: 'Hot', count: metrics.hot, className: 'hot' },
    { label: 'Warm', count: metrics.warm, className: 'warm' },
    { label: 'Cold', count: metrics.cold, className: 'cold' },
  ]

  const recentLeads = leads.slice(0, 6)

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

        <nav className="nav-list" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => setPage(item.id)}
              type="button"
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <span className="status-kicker">AUTOMATION</span>
          <div className="live-row">
            <span className="live-dot" />
            <span>Supabase connected</span>
          </div>
          <p>v2 rebuild · live data</p>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="search-box">
            <span>⌕</span>
            <input placeholder="Search leads, insights, reports..." aria-label="Search" />
          </div>
          <div className="topbar-meta">
            <span className="lead-count">{metrics.total} leads</span>
            <div className="owner-avatar">EK</div>
            <div className="owner-copy">
              <strong>Ed Rowell Kilat</strong>
              <span>Owner</span>
            </div>
          </div>
        </header>

        <main className="content">
          {page === 'dashboard' && (
            <DashboardPage
              loading={loading}
              error={error}
              metrics={metrics}
              distribution={distribution}
              weeklySummary={weeklySummary}
              recentLeads={recentLeads}
              setPage={setPage}
            />
          )}

          {page === 'analytics' && (
            <AnalyticsPage leads={leads} metrics={metrics} weeklySummary={weeklySummary} loading={loading} />
          )}

          {page !== 'dashboard' && page !== 'analytics' && (
            <section className="placeholder-page">
              <span className="mini-label">SMART CRM PORTAL · V2</span>
              <h1>{navItems.find((item) => item.id === page)?.label}</h1>
              <p>The design shell is wired. We&apos;ll connect this screen to the real workflow in the next build pass.</p>
              <button className="button primary" type="button" onClick={() => setPage('dashboard')}>Back to dashboard</button>
            </section>
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
  setPage,
}: {
  loading: boolean
  error: string | null
  metrics: { total: number; hot: number; warm: number; cold: number; pipeline: number }
  distribution: { label: string; count: number; className: string }[]
  weeklySummary: WeeklySummary | null
  recentLeads: Lead[]
  setPage: (page: Page) => void
}) {
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">SMART CRM PORTAL · V2</div>
          <h1>Good morning, Ed</h1>
          <p>Here&apos;s what&apos;s happening with your lead pipeline.</p>
        </div>
        <div className="heading-actions">
          <button className="button secondary" type="button" onClick={() => setPage('reports')}>
            Weekly report
          </button>
          <button className="button primary" type="button" onClick={() => setPage('add')}>
            + Add lead
          </button>
        </div>
      </section>

      {error && <div className="error-banner">Could not load CRM data: {error}</div>}

      <section className="kpi-grid" aria-label="Lead metrics">
        <MetricCard label="Total leads" value={loading ? '—' : String(metrics.total)} tone="blue" note="Stored in Supabase" />
        <MetricCard label="Hot" value={loading ? '—' : String(metrics.hot)} tone="red" note="High intent" />
        <MetricCard label="Warm" value={loading ? '—' : String(metrics.warm)} tone="amber" note="Needs nurture" />
        <MetricCard label="Cold" value={loading ? '—' : String(metrics.cold)} tone="cyan" note="Low intent" />
        <MetricCard label="Pipeline value" value={loading ? '—' : money(metrics.pipeline)} tone="violet" note="From lead budgets" wide />
      </section>

      <section className="automation-card">
        <div className="automation-glow" />
        <div className="section-heading">
          <div>
            <div className="title-row">
              <h2>Automation pipeline</h2>
              <span className="health-pill"><span /> All systems running</span>
            </div>
            <p>Every lead moves through a structured automation flow before reporting.</p>
          </div>
          <button className="button tertiary" type="button">View run log</button>
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
              <span className="mini-label">LEAD QUALITY</span>
              <h2>Pipeline mix</h2>
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
            <p>Latest captured records, sorted by arrival.</p>
          </div>
          <button className="button tertiary" type="button" onClick={() => setPage('leads')}>View all</button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Intent</th>
                <th>Status</th>
                <th>Budget</th>
                <th>Source</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {recentLeads.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <div className="lead-cell">
                      <span className="avatar">{initials(lead.name)}</span>
                      <div><strong>{lead.name || 'Unnamed lead'}</strong><span>{lead.email || 'No email'}</span></div>
                    </div>
                  </td>
                  <td>{lead.intent || '—'}</td>
                  <td><span className={`category-pill ${categoryClass(lead.category)}`}><i />{lead.category || 'Unclassified'}</span></td>
                  <td>{lead.budget ? money(parseBudget(lead.budget)) : '—'}</td>
                  <td>{lead.source || '—'}</td>
                  <td>{new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                </tr>
              ))}
              {!loading && recentLeads.length === 0 && (
                <tr><td className="empty-cell" colSpan={6}>No leads yet.</td></tr>
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
  metrics: { total: number; hot: number; warm: number; cold: number; pipeline: number }
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
      const categoryLeads = leads.filter((lead) => lead.category?.toLowerCase() === category)
      const values = categoryLeads.map((lead) => parseBudget(lead.budget)).filter((value) => value > 0)
      const total = values.reduce((sum, value) => sum + value, 0)
      return {
        label: category[0].toUpperCase() + category.slice(1),
        className: category,
        total,
        average: values.length ? total / values.length : 0,
      }
    })
  }, [leads])

  const avgBudget = metrics.total ? metrics.pipeline / metrics.total : 0
  const hotShare = percent(metrics.hot, metrics.total)
  const maxTrend = Math.max(...trend.map((item) => item.count), 1)
  const maxSource = Math.max(...sourceStats.map((item) => item.count), 1)
  const maxIntent = Math.max(...intentStats.map((item) => item.count), 1)
  const maxBudget = Math.max(...budgetStats.map((item) => item.total), 1)
  const dominantSource = sourceStats[0]
  const dominantIntent = intentStats[0]

  return (
    <>
      <section className="page-heading analytics-heading">
        <div>
          <div className="eyebrow">LIVE PIPELINE INTELLIGENCE</div>
          <h1>Analytics</h1>
          <p>Lead quality, acquisition, intent and budget signals from your Supabase data.</p>
        </div>
        <span className="analytics-live"><i /> Live data</span>
      </section>

      <section className="analytics-kpis">
        <AnalyticsMetric label="Hot lead share" value={loading ? '—' : `${hotShare}%`} note={`${metrics.hot} of ${metrics.total} leads`} accent="red" />
        <AnalyticsMetric label="Average lead budget" value={loading ? '—' : money(avgBudget)} note="Across stored records" accent="violet" />
        <AnalyticsMetric label="Top source" value={loading ? '—' : dominantSource?.label || '—'} note={dominantSource ? `${dominantSource.count} leads captured` : 'No source data'} accent="blue" />
        <AnalyticsMetric label="Primary intent" value={loading ? '—' : dominantIntent?.label || '—'} note={dominantIntent ? `${percent(dominantIntent.count, metrics.total)}% of pipeline` : 'No intent data'} accent="amber" />
      </section>

      <section className="analytics-grid analytics-grid-top">
        <article className="panel analytics-panel quality-panel">
          <AnalyticsPanelHeader kicker="LEAD QUALITY" title="Pipeline distribution" detail={`${metrics.total} total leads`} />
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
          <AnalyticsPanelHeader kicker="PIPELINE VALUE" title="Budget by lead quality" detail={money(metrics.pipeline)} />
          <div className="budget-bars">
            {budgetStats.map((item) => (
              <div className="budget-row" key={item.label}>
                <div className="budget-copy">
                  <span><i className={item.className} />{item.label}</span>
                  <strong>{money(item.total)}</strong>
                  <small>Avg {money(item.average)}</small>
                </div>
                <div className="budget-track"><span className={item.className} style={{ width: `${(item.total / maxBudget) * 100}%` }} /></div>
              </div>
            ))}
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
