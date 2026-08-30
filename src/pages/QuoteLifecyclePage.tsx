import { FormEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import '../quote-lifecycle.css'

type WorkspaceMembership = { workspace_id: string; role: string }
type LeadRow = { id: number; public_id: string; workspace_id: string | null; name: string | null; email: string | null; currency_code: string }
type QuoteRow = {
  id: string
  public_id: string
  workspace_id: string
  lead_id: number
  quote_reference: string | null
  amount: number | null
  currency_code: string
  status: 'draft' | 'sent' | 'receipt_confirmed' | 'accepted' | 'declined' | 'expired' | 'superseded'
  sent_at: string | null
  receipt_confirmed_at: string | null
  expected_decision_at: string | null
  next_follow_up_at: string | null
  last_call_outcome: string | null
  created_at: string
  updated_at: string
}

const STATUS_OPTIONS: QuoteRow['status'][] = ['draft', 'sent', 'receipt_confirmed', 'accepted', 'declined', 'expired']
const OUTCOME_OPTIONS = [
  ['confirmed_received', 'Confirmed received'],
  ['has_questions', 'Has questions'],
  ['ready_to_schedule', 'Ready to schedule'],
  ['decision_later', 'Decision later'],
  ['no_answer', 'No answer'],
  ['pricing_objection', 'Pricing objection'],
  ['urgent', 'Urgent'],
  ['not_interested', 'Not interested'],
] as const

function toLocalInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function fromLocalInput(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function money(value: number | null, currency: string) {
  if (value == null) return 'Amount not set'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value)
  } catch {
    return `${currency} ${value.toLocaleString()}`
  }
}

function statusLabel(value: QuoteRow['status']) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function QuoteLifecyclePage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspaceRole, setWorkspaceRole] = useState<string | null>(null)
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [leadId, setLeadId] = useState('')
  const [reference, setReference] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [status, setStatus] = useState<QuoteRow['status']>('draft')
  const [sentAt, setSentAt] = useState('')
  const [receiptAt, setReceiptAt] = useState('')
  const [decisionAt, setDecisionAt] = useState('')
  const [nextFollowUpAt, setNextFollowUpAt] = useState('')
  const [outcome, setOutcome] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const canManage = workspaceRole === 'owner' || workspaceRole === 'admin'
  const selected = useMemo(() => quotes.find((quote) => quote.id === selectedId) || null, [quotes, selectedId])
  const selectedLead = useMemo(() => leads.find((lead) => lead.id === Number(leadId)) || null, [leads, leadId])

  useEffect(() => {
    let active = true
    async function boot() {
      if (!supabase) {
        setError('Supabase is not configured.')
        setLoading(false)
        return
      }
      const { data: userData, error: userError } = await supabase.auth.getUser()
      const user = userData.user
      if (!active) return
      if (userError || !user) {
        setError(userError?.message || 'Could not resolve the current user.')
        setLoading(false)
        return
      }
      const membership = await supabase
        .from('workspace_members')
        .select('workspace_id, role')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(2)
      if (!active) return
      if (membership.error || !membership.data?.length) {
        setError(membership.error?.message || 'No workspace membership found.')
        setLoading(false)
        return
      }
      if (membership.data.length !== 1) {
        setError('Quote lifecycle currently requires one active workspace context.')
        setLoading(false)
        return
      }
      const resolved = membership.data[0] as WorkspaceMembership
      setWorkspaceId(resolved.workspace_id)
      setWorkspaceRole(resolved.role)
      await loadWorkspace(resolved.workspace_id)
    }
    void boot()
    return () => { active = false }
  }, [])

  async function loadWorkspace(resolvedWorkspaceId = workspaceId) {
    if (!supabase || !resolvedWorkspaceId) return
    setLoading(true)
    setError(null)
    const [leadResult, quoteResult] = await Promise.all([
      supabase
        .from('leads')
        .select('id, public_id, workspace_id, name, email, currency_code')
        .eq('workspace_id', resolvedWorkspaceId)
        .is('archived_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('lead_quotes')
        .select('*')
        .eq('workspace_id', resolvedWorkspaceId)
        .order('created_at', { ascending: false }),
    ])
    if (leadResult.error || quoteResult.error) {
      setError(leadResult.error?.message || quoteResult.error?.message || 'Could not load quote lifecycle data.')
    } else {
      setLeads((leadResult.data || []) as LeadRow[])
      const rows = (quoteResult.data || []) as QuoteRow[]
      setQuotes(rows)
      if (selectedId && !rows.some((row) => row.id === selectedId)) setSelectedId(null)
    }
    setLoading(false)
  }

  function resetDraft() {
    setSelectedId(null)
    setLeadId('')
    setReference('')
    setAmount('')
    setCurrency('USD')
    setStatus('draft')
    setSentAt('')
    setReceiptAt('')
    setDecisionAt('')
    setNextFollowUpAt('')
    setOutcome('')
    setNotice(null)
    setError(null)
  }

  function editQuote(quote: QuoteRow) {
    setSelectedId(quote.id)
    setLeadId(String(quote.lead_id))
    setReference(quote.quote_reference || '')
    setAmount(quote.amount == null ? '' : String(quote.amount))
    setCurrency(quote.currency_code)
    setStatus(quote.status)
    setSentAt(toLocalInput(quote.sent_at))
    setReceiptAt(toLocalInput(quote.receipt_confirmed_at))
    setDecisionAt(toLocalInput(quote.expected_decision_at))
    setNextFollowUpAt(toLocalInput(quote.next_follow_up_at))
    setOutcome(quote.last_call_outcome || '')
    setNotice(null)
    setError(null)
  }

  async function saveQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !workspaceId || !canManage) return
    const numericLeadId = Number(leadId)
    if (!Number.isFinite(numericLeadId) || !selectedLead) {
      setError('Select a lead in this workspace.')
      return
    }
    const numericAmount = amount.trim() ? Number(amount) : null
    if (numericAmount != null && (!Number.isFinite(numericAmount) || numericAmount < 0)) {
      setError('Quote amount must be zero or greater.')
      return
    }
    const normalizedSentAt = fromLocalInput(sentAt)
    const normalizedReceiptAt = fromLocalInput(receiptAt)
    const normalizedDecisionAt = fromLocalInput(decisionAt)
    if ((normalizedReceiptAt || normalizedDecisionAt) && !normalizedSentAt) {
      setError('Set the sent time before receipt confirmation or expected decision time.')
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    const payload = {
      workspace_id: workspaceId,
      lead_id: numericLeadId,
      quote_reference: reference.trim() || null,
      amount: numericAmount,
      currency_code: currency.trim().toUpperCase() || selectedLead.currency_code || 'USD',
      status,
      sent_at: normalizedSentAt,
      receipt_confirmed_at: normalizedReceiptAt,
      expected_decision_at: normalizedDecisionAt,
      next_follow_up_at: fromLocalInput(nextFollowUpAt),
      last_call_outcome: outcome || null,
    }
    const result = selectedId
      ? await supabase.from('lead_quotes').update(payload).eq('id', selectedId).eq('workspace_id', workspaceId).select('*').single()
      : await supabase.from('lead_quotes').insert(payload).select('*').single()
    if (result.error || !result.data) {
      setError(result.error?.message || 'Could not save quote.')
    } else {
      const saved = result.data as QuoteRow
      await supabase.from('lead_activities').insert({
        workspace_id: workspaceId,
        lead_id: saved.lead_id,
        activity_type: selectedId ? 'quote_updated' : 'quote_created',
        title: selectedId ? 'Quote updated' : 'Quote created',
        metadata: {
          quote_public_id: saved.public_id,
          quote_reference: saved.quote_reference,
          quote_status: saved.status,
          amount: saved.amount,
          currency_code: saved.currency_code,
        },
      })
      setSelectedId(saved.id)
      setNotice(selectedId ? 'Quote updated.' : 'Quote created.')
      await loadWorkspace(workspaceId)
    }
    setSaving(false)
  }

  return (
    <main className="quote-page-shell">
      <header className="quote-page-header">
        <div>
          <span className="mini-label">SALES RECOVERY</span>
          <h1>Quote lifecycle</h1>
          <p>Create, track, and confirm quote follow-up state. Alert delivery remains disabled in this gate.</p>
        </div>
        <div className="quote-header-actions">
          <a className="button secondary" href="/dashboard">← Dashboard</a>
          <button className="button primary" type="button" onClick={resetDraft}>New quote</button>
        </div>
      </header>

      <section className="quote-safety-banner">
        <strong>Safe lifecycle mode</strong>
        <span>This page writes quote lifecycle records and lead timeline events only. It does not create quote alerts or send Slack/email/provider messages.</span>
      </section>

      {error && <div className="quote-error" role="alert">{error}</div>}
      {notice && <div className="quote-notice" role="status">✓ {notice}</div>}

      <div className="quote-layout">
        <section className="quote-list-card">
          <div className="quote-card-heading">
            <div><span className="mini-label">WORKSPACE QUOTES</span><h2>Quotes</h2></div>
            <span>{quotes.length}</span>
          </div>
          {loading ? <p className="quote-empty">Loading quotes…</p> : quotes.length ? (
            <div className="quote-list">
              {quotes.map((quote) => {
                const lead = leads.find((item) => item.id === quote.lead_id)
                return (
                  <button key={quote.id} type="button" className={`quote-list-item ${selectedId === quote.id ? 'active' : ''}`} onClick={() => editQuote(quote)}>
                    <div><strong>{quote.quote_reference || quote.public_id}</strong><span>{lead?.name || 'Unnamed lead'}</span></div>
                    <div className="quote-list-right"><strong>{money(quote.amount, quote.currency_code)}</strong><span>{statusLabel(quote.status)}</span></div>
                  </button>
                )
              })}
            </div>
          ) : <p className="quote-empty">No quotes yet. Create one synthetic quote for the controlled QA gate.</p>}
        </section>

        <section className="quote-editor-card">
          <div className="quote-card-heading">
            <div><span className="mini-label">{selected ? 'EDIT QUOTE' : 'NEW QUOTE'}</span><h2>{selected ? selected.quote_reference || selected.public_id : 'Create quote'}</h2></div>
            {selected && <span>{statusLabel(selected.status)}</span>}
          </div>

          <form className="quote-form" onSubmit={saveQuote}>
            <label><span>Lead</span><select value={leadId} onChange={(event) => {
              setLeadId(event.target.value)
              const lead = leads.find((item) => item.id === Number(event.target.value))
              if (lead && !selectedId) setCurrency(lead.currency_code || 'USD')
            }} disabled={!canManage || Boolean(selectedId)} required>
              <option value="">Select a lead</option>
              {leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name || 'Unnamed lead'} · {lead.public_id}</option>)}
            </select></label>

            <div className="quote-form-grid">
              <label><span>Quote reference</span><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="e.g. QA-QUOTE-001" maxLength={120} /></label>
              <label><span>Amount</span><input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="4200" /></label>
              <label><span>Currency</span><input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={3} pattern="[A-Z]{3}" /></label>
              <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as QuoteRow['status'])}>{STATUS_OPTIONS.map((item) => <option value={item} key={item}>{statusLabel(item)}</option>)}</select></label>
              <label><span>Sent at</span><input type="datetime-local" value={sentAt} onChange={(event) => setSentAt(event.target.value)} /></label>
              <label><span>Receipt confirmed</span><input type="datetime-local" value={receiptAt} onChange={(event) => setReceiptAt(event.target.value)} /></label>
              <label><span>Expected decision</span><input type="datetime-local" value={decisionAt} onChange={(event) => setDecisionAt(event.target.value)} /></label>
              <label><span>Next follow-up</span><input type="datetime-local" value={nextFollowUpAt} onChange={(event) => setNextFollowUpAt(event.target.value)} /></label>
            </div>

            <label><span>Latest call outcome</span><select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="">No call outcome</option>{OUTCOME_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>

            <div className="quote-form-actions">
              <button className="button secondary" type="button" onClick={resetDraft}>Clear</button>
              <button className="button primary" type="submit" disabled={!canManage || saving || !leadId}>{saving ? 'Saving…' : selectedId ? 'Save quote' : 'Create quote'}</button>
            </div>
            {!canManage && <p className="quote-helper">Owner or admin access is required to manage quotes.</p>}
          </form>
        </section>
      </div>
    </main>
  )
}
