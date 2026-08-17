import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'

type WeeklySummary = Database['public']['Tables']['weekly_summary']['Row']

function share(value: number | null, total: number | null) {
  if (!value || !total) return 0
  return Math.round((value / total) * 100)
}

export default function ReportsPage() {
  const [reports, setReports] = useState<WeeklySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadReports() {
      if (!supabase) {
        setError('Supabase is not configured for this environment.')
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)
      const { data, error: loadError } = await supabase
        .from('weekly_summary')
        .select('*')
        .order('created_at', { ascending: false })

      if (!active) return

      if (loadError) setError(loadError.message)
      else setReports(data || [])
      setLoading(false)
    }

    loadReports()
    return () => {
      active = false
    }
  }, [])

  const latest = reports[0]
  const previous = reports[1]

  const delta = useMemo(() => {
    if (!latest || !previous || previous.total_leads == null || latest.total_leads == null) return null
    return latest.total_leads - previous.total_leads
  }, [latest, previous])

  return (
    <>
      <section className="page-heading connected-page-heading">
        <div>
          <div className="eyebrow">AUTOMATED WEEKLY REPORTING</div>
          <h1>Reports</h1>
          <p>Weekly summaries written by the n8n reporting workflow and stored in Supabase.</p>
        </div>
        <span className="workflow-live-pill"><i /> Supabase report history</span>
      </section>

      {error && <div className="error-banner">Could not load reports: {error}</div>}

      {loading && <section className="panel report-empty">Loading weekly reports…</section>}

      {!loading && !latest && (
        <section className="panel report-empty">
          <span className="mini-label">NO REPORTS YET</span>
          <h2>Waiting for the weekly workflow</h2>
          <p>The first report will appear here after the n8n weekly-summary workflow writes a record.</p>
        </section>
      )}

      {latest && (
        <>
          <section className="report-hero panel">
            <div className="report-hero-copy">
              <div className="report-period-row">
                <span className="mini-label">LATEST REPORT</span>
                <span className="report-period">{latest.period}</span>
              </div>
              <h2>Weekly pipeline intelligence</h2>
              <p>{latest.ai_summary || 'No AI summary was saved for this reporting period.'}</p>
              <div className="report-meta">
                <span>Generated {new Date(latest.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                {delta !== null && <span className={delta >= 0 ? 'positive' : 'negative'}>{delta >= 0 ? '+' : ''}{delta} leads vs prior report</span>}
              </div>
            </div>
            <div className="report-total-card">
              <span>Total leads</span>
              <strong>{latest.total_leads ?? '—'}</strong>
              <small>for this report period</small>
            </div>
          </section>

          <section className="report-kpi-grid">
            {[
              ['Hot leads', latest.hot_leads, 'hot'],
              ['Warm leads', latest.warm_leads, 'warm'],
              ['Cold leads', latest.cold_leads, 'cold'],
            ].map(([label, value, tone]) => (
              <article className="panel report-kpi" key={String(label)}>
                <span className={`report-tone ${tone}`} />
                <div><span>{label}</span><strong>{value ?? '—'}</strong></div>
                <small>{share(value as number | null, latest.total_leads)}% of weekly leads</small>
              </article>
            ))}
          </section>

          <section className="panel report-history-panel">
            <div className="section-heading compact">
              <div>
                <span className="mini-label">REPORT ARCHIVE</span>
                <h2>Weekly history</h2>
                <p>Newest reports appear first as the automation writes them.</p>
              </div>
              <span className="results-count">{reports.length} report{reports.length === 1 ? '' : 's'}</span>
            </div>

            <div className="report-history-list">
              {reports.map((report, index) => (
                <article className={`report-history-item ${index === 0 ? 'current' : ''}`} key={report.id}>
                  <div className="history-period">
                    <span>{index === 0 ? 'Latest' : `#${reports.length - index}`}</span>
                    <strong>{report.period}</strong>
                    <small>{new Date(report.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</small>
                  </div>
                  <div className="history-counts">
                    <span><i className="hot" />{report.hot_leads ?? 0} Hot</span>
                    <span><i className="warm" />{report.warm_leads ?? 0} Warm</span>
                    <span><i className="cold" />{report.cold_leads ?? 0} Cold</span>
                  </div>
                  <p>{report.ai_summary || 'No AI summary saved.'}</p>
                  <strong className="history-total">{report.total_leads ?? '—'} <small>leads</small></strong>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  )
}
