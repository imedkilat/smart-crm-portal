import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import { useWorkspace } from '../workspace-context'

type WeeklySummary = Database['public']['Tables']['weekly_summary']['Row']

function share(value: number | null, total: number | null) {
  if (!value || !total) return 0
  return Math.round((value / total) * 100)
}

function signed(value: number | null) {
  const number = value ?? 0
  return `${number >= 0 ? '+' : ''}${number}`
}

function weeklyTotal(report: WeeklySummary) {
  return report.report_version >= 2 ? report.new_leads ?? 0 : report.total_leads ?? 0
}

function weeklyHot(report: WeeklySummary) {
  return report.report_version >= 2 ? report.new_hot_leads ?? 0 : report.hot_leads ?? 0
}

function weeklyWarm(report: WeeklySummary) {
  return report.report_version >= 2 ? report.new_warm_leads ?? 0 : report.warm_leads ?? 0
}

function weeklyCold(report: WeeklySummary) {
  return report.report_version >= 2 ? report.new_cold_leads ?? 0 : report.cold_leads ?? 0
}

export default function ReportsPage() {
  const { activeWorkspace } = useWorkspace()
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
        .eq('workspace_id', activeWorkspace.workspaceId)
        .order('created_at', { ascending: false })

      if (!active) return

      if (loadError) setError(loadError.message)
      else setReports((data || []) as WeeklySummary[])
      setLoading(false)
    }

    void loadReports()
    return () => {
      active = false
    }
  }, [activeWorkspace.workspaceId])

  const latest = reports[0]
  const latestIsV2 = Boolean(latest && latest.report_version >= 2)
  const previousCompatible = useMemo(() => {
    if (!latest) return undefined
    return reports.slice(1).find((report) => report.report_version === latest.report_version)
  }, [latest, reports])

  const legacyDelta = useMemo(() => {
    if (!latest || latestIsV2 || !previousCompatible || previousCompatible.total_leads == null || latest.total_leads == null) return null
    return latest.total_leads - previousCompatible.total_leads
  }, [latest, latestIsV2, previousCompatible])

  return (
    <>
      <section className="page-heading connected-page-heading">
        <div>
          <div className="eyebrow">AUTOMATED WEEKLY REPORTING</div>
          <h1>Reports</h1>
          <p>Verified weekly CRM snapshots stored in Supabase. V2 reports use real database calculations only.</p>
        </div>
        <span className="workflow-live-pill"><i /> {latestIsV2 ? 'Verified metrics v2' : 'Supabase report history'}</span>
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
                <span className="mini-label">{latestIsV2 ? 'VERIFIED WEEKLY SNAPSHOT' : 'LEGACY REPORT'}</span>
                <span className="report-period">{latest.period}</span>
              </div>
              <h2>{latestIsV2 ? 'Weekly lead intake' : 'Weekly pipeline intelligence'}</h2>
              <p>
                {latest.ai_summary || (latestIsV2
                  ? 'Verified CRM metrics are saved for this completed week. AI commentary will appear after the v2 n8n workflow completes its first successful run.'
                  : 'No AI summary was saved for this reporting period.')}
              </p>
              <div className="report-meta">
                <span>Generated {new Date(latest.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                {latestIsV2 ? (
                  <span className={(latest.new_leads_change ?? 0) >= 0 ? 'positive' : 'negative'}>
                    {signed(latest.new_leads_change)} new leads vs prior completed week
                  </span>
                ) : legacyDelta !== null ? (
                  <span className={legacyDelta >= 0 ? 'positive' : 'negative'}>{signed(legacyDelta)} leads vs prior report</span>
                ) : null}
              </div>
              {latestIsV2 && (
                <div className="report-meta">
                  <span>Active pipeline snapshot: {latest.total_leads ?? 0} leads</span>
                  <span>{latest.hot_leads ?? 0} Hot · {latest.warm_leads ?? 0} Warm · {latest.cold_leads ?? 0} Cold routing</span>
                  <span>{latest.data_timezone}</span>
                </div>
              )}
            </div>
            <div className="report-total-card">
              <span>{latestIsV2 ? 'New leads' : 'Total leads'}</span>
              <strong>{weeklyTotal(latest)}</strong>
              <small>{latestIsV2 ? 'during this completed week' : 'for this report period'}</small>
            </div>
          </section>

          <section className="report-kpi-grid">
            {[
              ['Hot', weeklyHot(latest), 'hot', latestIsV2 ? latest.hot_change : null],
              ['Warm', weeklyWarm(latest), 'warm', latestIsV2 ? latest.warm_change : null],
              ['Cold', weeklyCold(latest), 'cold', latestIsV2 ? latest.cold_change : null],
            ].map(([label, value, tone, change]) => (
              <article className="panel report-kpi" key={String(label)}>
                <span className={`report-tone ${tone}`} />
                <div><span>{latestIsV2 ? `New ${label} leads` : `${label} leads`}</span><strong>{value}</strong></div>
                <small>
                  {share(value as number, weeklyTotal(latest))}% of weekly intake
                  {latestIsV2 ? ` · ${signed(change as number | null)} vs prior week` : ''}
                </small>
              </article>
            ))}
          </section>

          <section className="panel report-history-panel">
            <div className="section-heading compact">
              <div>
                <span className="mini-label">REPORT ARCHIVE</span>
                <h2>Weekly history</h2>
                <p>V2 snapshots use completed-week intake, immutable AI classification and real week-over-week deltas.</p>
              </div>
              <span className="results-count">{reports.length} report{reports.length === 1 ? '' : 's'}</span>
            </div>

            <div className="report-history-list">
              {reports.map((report, index) => {
                const isV2 = report.report_version >= 2
                return (
                  <article className={`report-history-item ${index === 0 ? 'current' : ''}`} key={report.id}>
                    <div className="history-period">
                      <span>{isV2 ? (index === 0 ? 'Latest v2' : 'Verified v2') : 'Legacy'}</span>
                      <strong>{report.period}</strong>
                      <small>{new Date(report.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</small>
                    </div>
                    <div className="history-counts">
                      <span><i className="hot" />{weeklyHot(report)} Hot</span>
                      <span><i className="warm" />{weeklyWarm(report)} Warm</span>
                      <span><i className="cold" />{weeklyCold(report)} Cold</span>
                    </div>
                    <p>{report.ai_summary || (isV2 ? 'Verified metrics saved. AI commentary pending.' : 'No AI summary saved.')}</p>
                    <strong className="history-total">{weeklyTotal(report)} <small>{isV2 ? 'new leads' : 'leads'}</small></strong>
                  </article>
                )
              })}
            </div>
          </section>
        </>
      )}
    </>
  )
}
