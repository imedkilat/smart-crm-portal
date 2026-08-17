import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import LeadProfileDrawer from './LeadProfileDrawer'

type Lead = Database['public']['Tables']['leads']['Row']

function initials(name: string | null) {
  if (!name) return '—'
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

function statusValue(lead: Lead) {
  return lead.routing_status || lead.category || 'Unclassified'
}

function statusClass(value: string | null) {
  const normalized = (value || '').toLowerCase()
  if (normalized === 'hot') return 'hot'
  if (normalized === 'warm') return 'warm'
  return 'cold'
}

function searchScore(lead: Lead, query: string) {
  const q = query.toLowerCase()
  const name = (lead.name || '').toLowerCase()
  const email = (lead.email || '').toLowerCase()
  const routing = statusValue(lead).toLowerCase()
  const intent = (lead.intent || '').toLowerCase()
  const source = (lead.source || '').toLowerCase()
  const category = (lead.category || '').toLowerCase()
  const summary = (lead.summary || '').toLowerCase()
  const message = (lead.message || '').toLowerCase()
  const budget = (lead.budget || '').toLowerCase()

  if (name === q || email === q) return 100
  if (name.startsWith(q)) return 90
  if (email.startsWith(q)) return 85
  if (name.includes(q)) return 80
  if (email.includes(q)) return 75
  if (routing === q || intent === q || source === q || category === q) return 65
  if (routing.includes(q) || intent.includes(q) || source.includes(q) || category.includes(q)) return 55
  if (summary.includes(q)) return 40
  if (message.includes(q)) return 30
  if (budget.includes(q)) return 20
  return 0
}

export default function GlobalSearch() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function loadLeads() {
    if (!supabase) return
    setLoading(true)

    let request = supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })

    const { data, error } = await request

    if (!error) {
      const activeLeads = ((data || []) as Lead[]).filter((lead) => !('archived_at' in lead) || !lead.archived_at)
      setLeads(activeLeads)
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadLeads()
  }, [])

  useEffect(() => {
    function handleOutside(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }

    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
        void loadLeads()
      }
    }

    document.addEventListener('mousedown', handleOutside)
    window.addEventListener('keydown', handleShortcut)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      window.removeEventListener('keydown', handleShortcut)
    }
  }, [])

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return []

    return leads
      .map((lead) => ({ lead, score: searchScore(lead, normalized) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || new Date(b.lead.created_at).getTime() - new Date(a.lead.created_at).getTime())
      .slice(0, 8)
      .map((item) => item.lead)
  }, [leads, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  function openLead(lead: Lead) {
    setSelectedLead(lead)
    setOpen(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
      return
    }

    if (!open || results.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % results.length)
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + results.length) % results.length)
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      openLead(results[activeIndex] || results[0])
    }
  }

  function handleLeadUpdated(updatedLead: Lead) {
    setLeads((current) => current.map((lead) => lead.id === updatedLead.id ? updatedLead : lead))
    setSelectedLead(updatedLead)
  }

  return (
    <>
      <div className="global-search" ref={wrapperRef}>
        <div className={`global-search-input ${open ? 'is-open' : ''}`}>
          <span className="global-search-icon">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
            }}
            onFocus={() => {
              setOpen(true)
              void loadLeads()
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search leads across the CRM..."
            aria-label="Global CRM search"
            aria-expanded={open}
            aria-controls="global-search-results"
            autoComplete="off"
          />
          {query ? (
            <button
              className="global-search-clear"
              type="button"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
              aria-label="Clear search"
            >
              ×
            </button>
          ) : (
            <span className="global-search-shortcut">Ctrl K</span>
          )}
        </div>

        {open && (
          <div className="global-search-dropdown" id="global-search-results" role="listbox">
            {!query.trim() ? (
              <div className="global-search-hint">
                <span className="mini-label">GLOBAL SEARCH</span>
                <strong>Find any active lead</strong>
                <p>Search by name, email, routing status, intent, source, AI summary or inquiry.</p>
              </div>
            ) : loading && leads.length === 0 ? (
              <div className="global-search-empty">Searching CRM…</div>
            ) : results.length ? (
              <>
                <div className="global-search-heading">
                  <span>LEADS</span>
                  <small>{results.length} match{results.length === 1 ? '' : 'es'}</small>
                </div>
                <div className="global-search-results">
                  {results.map((lead, index) => {
                    const routing = statusValue(lead)
                    return (
                      <button
                        key={lead.id}
                        type="button"
                        className={`global-search-result ${activeIndex === index ? 'active' : ''}`}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => openLead(lead)}
                        role="option"
                        aria-selected={activeIndex === index}
                      >
                        <span className="global-search-avatar">{initials(lead.name)}</span>
                        <span className="global-search-copy">
                          <strong>{lead.name || 'Unnamed lead'}</strong>
                          <small>{lead.email || 'No email'} · {lead.intent || 'No intent'}</small>
                        </span>
                        <span className="global-search-meta">
                          <span className={`global-search-status ${statusClass(routing)}`}><i />{routing}</span>
                          <small>{lead.source || 'Unknown source'}</small>
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div className="global-search-footer">
                  <span>↑↓ Navigate</span><span>Enter Open</span><span>Esc Close</span>
                </div>
              </>
            ) : (
              <div className="global-search-empty">
                <strong>No active leads found</strong>
                <span>Try a name, email, status, intent or source.</span>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedLead && (
        <LeadProfileDrawer
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdated={handleLeadUpdated}
        />
      )}
    </>
  )
}
