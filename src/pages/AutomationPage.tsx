import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import LeadProfileDrawer from '../components/LeadProfileDrawer'

type Lead = Database['public']['Tables']['leads']['Row']
type RoutingEvent = Database['public']['Tables']['lead_routing_history']['Row']
type ResultFilter = 'all' | 'accepted' | 'suppressed_24h' | 'failed'
type RouteFilter = 'all' | 'Hot' | 'Warm' | 'Cold'

function resultLabel(value: string) {
  if (value === 'accepted') return 'Started'
  if (value === 'suppressed_24h') return 'Suppressed'
  if (value === 'failed') return 'Failed'
  return value.replace(/_/g, ' ')
}

function resultClass(value: string) {
  if (value === 'accepted') return 'success'
  if (value === 'suppressed_24h') return 'suppressed'
  if (value === 'failed') return 'failed'
  return 'neutral'
}

function routeClass(value: string | null) {
  const normalized = (value || '').toLowerCase()
  if (normalized === 'hot') return 'hot'
  if (normalized === 'warm') return 'warm'
  return 'cold'
}

export default function AutomationPage() {
  const [events, setEvents] = useState<RoutingEvent[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [routeFilter, setRouteFilter] = useState<RouteFilter>('all')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)

  const loadRuns = useCallback(async (background = false) => {
    if (!supabase) {
      setError('Supabase is not configured for this environment.')
      setLoading(false)
      return
    }

    if (background) setRefreshing(true)
    else setLoading(true)
    setError(null)

    const [eventsResult, leadsResult] = await Promise.all([
      supabase.from('lead_routing_history').select('*').order('changed_at', { ascending: false }).limit(100),
      supabase.from('leads').select('*').order('created_at', { ascending: false }),
    ])

    if (eventsResult.error) setError(eventsResult.error.message)
    else setEvents((eventsResult.data || []) as RoutingEvent[])

    if (!leadsResult.error) setLeads((leadsResult.data || []) as Lead[])

    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => { void loadRuns() }, [loadRuns])

  const leadMap = useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads])

  const filtered = useMemo(() => events.filter((event) => {
    if (resultFilter !== 'all' && event.automation_result !== resultFilter) return false
    if (routeFilter !== 'all' && event.to_status !== routeFilter) return false
    return true
  }), [events, resultFilter, routeFilter])

  const stats = useMemo(() => ({
    total: events.length,
    started: events.filter((event) => event.automation_result === 'accepted').length,
    suppressed: events.filter((event) => event.automation_result === 'suppressed_24h').length,
    failed: events.filter((event) => event.automation_result === 'failed').length,
  }), [events])

  function handleLeadUpdated(updatedLead: Lead) {
    setLeads((current) => current.map((lead) => lead.id === updatedLead.id ? updatedLead : lead))
    setSelectedLead(updatedLead)
  }

  return (
    <>
      <section className="page-heading connected-page-heading">
        <div>
          <div className="eyebrow">AUTOMATION OBSERVABILITY</div>
          <h1>Run Log</h1>
          <p>Live routing history from Supabase, including accepted, suppressed and failed CRM automation requests.</p>
        </div>
        <button className="button secondary" type="button" onClick={() => void loadRuns(true)} disabled={refreshing || loading}>
          {refreshing ? 'Refreshing…' : '↻ Refresh log'}
        </button>
      </section>

      {error && <div className="error-banner">Could not load automation history: {error}</div>}

      <section className="runlog-kpis" aria-label="Automation run metrics">
        <article className="runlog-kpi"><span>Total events</span><strong>{loading ? '—' : stats.total}</strong><small>Latest 100 routing events</small></article>
        <article className="runlog-kpi success"><span>Started</span><strong>{loading ? '—' : stats.started}</strong><small>Accepted by n8n</small></article>
        <article className="runlog-kpi suppressed"><span>Suppressed</span><strong>{loading ? '—' : stats.suppressed}</strong><small>24h duplicate guard</small></article>
        <article className="runlog-kpi failed"><span>Failed</span><strong>{loading ? '—' : stats.failed}</strong><small>Webhook did not start</small></article>
      </section>

      <section className="panel runlog-panel">
        <div className="runlog-toolbar">
          <div>
            <span className="mini-label">ROUTING EVENTS</span>
            <h2>Automation activity</h2>
          </div>
          <div className="runlog-filters">
            <select value={routeFilter} onChange={(event) => setRouteFilter(event.target.value as RouteFilter)} aria-label="Filter by route">
              <option value="all">All routes</option>
              <option value="Hot">Hot</option>
              <option value="Warm">Warm</option>
              <option value="Cold">Cold</option>
            </select>
            <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value as ResultFilter)} aria-label="Filter by result">
              <option value="all">All results</option>
              <option value="accepted">Started</option>
              <option value="suppressed_24h">Suppressed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        <div className="table-wrap runlog-table-wrap">
          <table>
            <thead><tr><th>Lead</th><th>Route change</th><th>Result</th><th>Triggered</th><th>Changed</th><th>Event ID</th></tr></thead>
            <tbody>
              {filtered.map((event) => {
                const lead = leadMap.get(event.lead_id)
                return (
                  <tr key={event.id} className={lead ? 'runlog-row clickable' : 'runlog-row'} onClick={() => lead && setSelectedLead(lead)}>
                    <td>
                      <div className="runlog-lead">
                        <strong>{lead?.name || `Lead #${event.lead_id}`}</strong>
                        <span>{lead?.email || (lead?.archived_at ? 'Archived lead' : 'Lead record unavailable')}</span>
                      </div>
                    </td>
                    <td><span className={`runlog-route ${routeClass(event.to_status)}`}>{event.from_status || 'Unclassified'} → {event.to_status}</span></td>
                    <td><span className={`runlog-result ${resultClass(event.automation_result)}`}>{resultLabel(event.automation_result)}</span></td>
                    <td>{event.automation_triggered ? 'Yes' : 'No'}</td>
                    <td>{new Date(event.changed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                    <td><code>{event.event_key.slice(0, 8)}</code></td>
                  </tr>
                )
              })}
              {!loading && filtered.length === 0 && <tr><td className="empty-cell" colSpan={6}>No automation events match these filters.</td></tr>}
              {loading && <tr><td className="empty-cell" colSpan={6}>Loading automation activity…</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {selectedLead && <LeadProfileDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} onUpdated={handleLeadUpdated} />}
    </>
  )
}
