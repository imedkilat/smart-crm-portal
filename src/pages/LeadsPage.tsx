import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import LeadProfileDrawer from '../components/LeadProfileDrawer'

type Lead = Database['public']['Tables']['leads']['Row']

type Props = {
  onLoaded?: (leads: Lead[]) => void
  onAddLead?: () => void
}

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
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
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

export default function LeadsPage({ onLoaded, onAddLead }: Props) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [archivingId, setArchivingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'all' | 'hot' | 'warm' | 'cold'>('all')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)

  const loadLeads = useCallback(async (background = false) => {
    if (!supabase) {
      setError('Supabase is not configured for this environment.')
      setLoading(false)
      setRefreshing(false)
      return
    }

    if (background) setRefreshing(true)
    else setLoading(true)
    setError(null)

    const { data, error: loadError } = await supabase
      .from('leads')
      .select('*')
      .is('archived_at', null)
      .order('created_at', { ascending: false })

    if (loadError) {
      setError(loadError.message)
    } else {
      const rows = (data || []) as Lead[]
      setLeads(rows)
      setLastUpdated(new Date())
      onLoaded?.(rows)
      setSelectedLead((current) => current ? rows.find((lead) => lead.id === current.id) || null : null)
    }

    setLoading(false)
    setRefreshing(false)
  }, [onLoaded])

  useEffect(() => { void loadLeads() }, [loadLeads])

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return leads.filter((lead) => {
      const routing = statusValue(lead).toLowerCase()
      if (category !== 'all' && routing !== category) return false
      if (!normalizedQuery) return true
      return [lead.name, lead.email, lead.intent, lead.category, lead.routing_status, lead.source, lead.summary, lead.message]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery))
    })
  }, [leads, query, category])

  const counts = useMemo(() => ({
    all: leads.length,
    hot: leads.filter((lead) => statusValue(lead).toLowerCase() === 'hot').length,
    warm: leads.filter((lead) => statusValue(lead).toLowerCase() === 'warm').length,
    cold: leads.filter((lead) => statusValue(lead).toLowerCase() === 'cold').length,
  }), [leads])

  function handleLeadUpdated(updatedLead: Lead) {
    const nextRows = leads.map((lead) => lead.id === updatedLead.id ? updatedLead : lead)
    setLeads(nextRows)
    setSelectedLead(updatedLead)
    setLastUpdated(new Date())
    onLoaded?.(nextRows)
  }

  async function archiveLead(lead: Lead) {
    if (!supabase) return
    const confirmed = window.confirm(`Archive ${lead.name || 'this lead'}?\n\nThe lead will be removed from the active CRM views, but the database record and routing history will be preserved.`)
    if (!confirmed) return

    setArchivingId(lead.id)
    setError(null)
    const { error: archiveError } = await supabase
      .from('leads')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', lead.id)

    if (archiveError) {
      setError(`Could not archive lead: ${archiveError.message}`)
    } else {
      const nextRows = leads.filter((item) => item.id !== lead.id)
      setLeads(nextRows)
      setSelectedLead((current) => current?.id === lead.id ? null : current)
      setLastUpdated(new Date())
      onLoaded?.(nextRows)
    }
    setArchivingId(null)
  }

  return (
    <>
      <section className="page-heading connected-page-heading">
        <div>
          <div className="eyebrow">LIVE CRM DATABASE</div>
          <h1>Leads</h1>
          <p>Search, filter and review every active lead currently stored in Supabase.</p>
        </div>
        <button className="button primary" type="button" onClick={onAddLead}>+ Add lead</button>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <section className="lead-stat-strip" aria-label="Routing status counts">
        {(['all', 'hot', 'warm', 'cold'] as const).map((item) => (
          <button key={item} type="button" className={`lead-stat ${category === item ? 'active' : ''}`} onClick={() => setCategory(item)}>
            <span>{item === 'all' ? 'All leads' : item[0].toUpperCase() + item.slice(1)}</span>
            <strong>{loading ? '—' : counts[item]}</strong>
          </button>
        ))}
      </section>

      <section className="panel leads-panel">
        <div className="leads-toolbar">
          <div className="leads-search">
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, intent, source or AI summary..." aria-label="Search leads" />
          </div>
          <div className="leads-toolbar-actions">
            <button className={`leads-refresh-button ${refreshing ? 'refreshing' : ''}`} type="button" onClick={() => void loadLeads(true)} disabled={refreshing || loading} aria-label="Refresh leads" title="Refresh leads only"><span aria-hidden="true">↻</span></button>
            <div className="results-meta"><span className="results-count">{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>{lastUpdated && <small aria-live="polite">Updated {lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>}</div>
          </div>
        </div>

        <div className={`table-wrap leads-table-wrap ${refreshing ? 'is-refreshing' : ''}`}>
          <table>
            <thead><tr><th>Lead</th><th>Intent</th><th>Routing status</th><th>Budget</th><th>Source</th><th>AI summary</th><th>Added</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {filtered.map((lead) => {
                const routing = statusValue(lead)
                return (
                  <tr key={lead.id} className="lead-table-row" tabIndex={0} onClick={() => setSelectedLead(lead)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedLead(lead) } }} aria-label={`Open ${lead.name || 'lead'} details`}>
                    <td><div className="lead-cell"><span className="avatar">{initials(lead.name)}</span><div><strong>{lead.name || 'Unnamed lead'}</strong><span>{lead.email || 'No email'}</span></div></div></td>
                    <td>{lead.intent || '—'}</td>
                    <td><span className={`category-pill ${categoryClass(routing)}`}><i />{routing}</span></td>
                    <td>{lead.budget ? money(parseBudget(lead.budget)) : '—'}</td>
                    <td>{lead.source || '—'}</td>
                    <td className="summary-cell" title={lead.summary || lead.message || ''}>{lead.summary || lead.message || '—'}</td>
                    <td>{new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td className="lead-row-actions"><button type="button" className="lead-archive-row-button" disabled={archivingId === lead.id} onClick={(event) => { event.stopPropagation(); void archiveLead(lead) }}>{archivingId === lead.id ? '…' : 'Archive'}</button></td>
                  </tr>
                )
              })}
              {!loading && filtered.length === 0 && <tr><td className="empty-cell" colSpan={8}>No leads match this view.</td></tr>}
              {loading && <tr><td className="empty-cell" colSpan={8}>Loading live leads…</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {selectedLead && <LeadProfileDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} onUpdated={handleLeadUpdated} />}
    </>
  )
}
