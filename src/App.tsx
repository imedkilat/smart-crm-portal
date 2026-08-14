import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import type { Database } from './types/database'

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
          {page === 'dashboard' ? (
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
                      const pct = metrics.total ? Math.round((item.count / metrics.total) * 100) : 0
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
          ) : (
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
