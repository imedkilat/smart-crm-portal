import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'

type Lead = Database['public']['Tables']['leads']['Row']

type Props = {
  onLoaded?: (leads: Lead[]) => void
  onAddLead?: () => void
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

function categoryClass(category: string | null) {
  const value = (category || '').toLowerCase()
  if (value === 'hot') return 'hot'
  if (value === 'warm') return 'warm'
  return 'cold'
}

export default function LeadsPage({ onLoaded, onAddLead }: Props) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'all' | 'hot' | 'warm' | 'cold'>('all')

  useEffect(() => {
    let active = true

    async function loadLeads() {
      if (!supabase) {
        setError('Supabase is not configured for this environment.')
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)
      const { data, error: loadError } = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false })

      if (!active) return

      if (loadError) {
        setError(loadError.message)
      } else {
        const rows = data || []
        setLeads(rows)
        onLoaded?.(rows)
      }
      setLoading(false)
    }

    loadLeads()
    return () => {
      active = false
    }
  }, [onLoaded])

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return leads.filter((lead) => {
      const matchesCategory = category === 'all' || lead.category?.toLowerCase() === category
      if (!matchesCategory) return false
      if (!normalizedQuery) return true

      return [lead.name, lead.email, lead.intent, lead.category, lead.source, lead.summary, lead.message]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery))
    })
  }, [leads, query, category])

  const counts = useMemo(() => ({
    all: leads.length,
    hot: leads.filter((lead) => lead.category?.toLowerCase() === 'hot').length,
    warm: leads.filter((lead) => lead.category?.toLowerCase() === 'warm').length,
    cold: leads.filter((lead) => lead.category?.toLowerCase() === 'cold').length,
  }), [leads])

  return (
    <>
      <section className="page-heading connected-page-heading">
        <div>
          <div className="eyebrow">LIVE CRM DATABASE</div>
          <h1>Leads</h1>
          <p>Search, filter and review every lead currently stored in Supabase.</p>
        </div>
        <button className="button primary" type="button" onClick={onAddLead}>+ Add lead</button>
      </section>

      {error && <div className="error-banner">Could not load leads: {error}</div>}

      <section className="lead-stat-strip" aria-label="Lead status counts">
        {(['all', 'hot', 'warm', 'cold'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`lead-stat ${category === item ? 'active' : ''}`}
            onClick={() => setCategory(item)}
          >
            <span>{item === 'all' ? 'All leads' : item[0].toUpperCase() + item.slice(1)}</span>
            <strong>{loading ? '—' : counts[item]}</strong>
          </button>
        ))}
      </section>

      <section className="panel leads-panel">
        <div className="leads-toolbar">
          <div className="leads-search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email, intent, source or AI summary..."
              aria-label="Search leads"
            />
          </div>
          <span className="results-count">{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
        </div>

        <div className="table-wrap leads-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Intent</th>
                <th>Status</th>
                <th>Budget</th>
                <th>Source</th>
                <th>AI summary</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <div className="lead-cell">
                      <span className="avatar">{initials(lead.name)}</span>
                      <div>
                        <strong>{lead.name || 'Unnamed lead'}</strong>
                        <span>{lead.email || 'No email'}</span>
                      </div>
                    </div>
                  </td>
                  <td>{lead.intent || '—'}</td>
                  <td>
                    <span className={`category-pill ${categoryClass(lead.category)}`}>
                      <i />{lead.category || 'Unclassified'}
                    </span>
                  </td>
                  <td>{lead.budget ? money(parseBudget(lead.budget)) : '—'}</td>
                  <td>{lead.source || '—'}</td>
                  <td className="summary-cell" title={lead.summary || lead.message || ''}>
                    {lead.summary || lead.message || '—'}
                  </td>
                  <td>{new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td className="empty-cell" colSpan={7}>No leads match this view.</td></tr>
              )}
              {loading && (
                <tr><td className="empty-cell" colSpan={7}>Loading live leads…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
