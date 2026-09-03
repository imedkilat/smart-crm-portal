import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'

type Lead = Database['public']['Tables']['leads']['Row']
type CallLead = Lead & {
  phone_e164?: string | null
  owner_user_id?: string | null
}

type MemberDirectoryRow = {
  user_id: string
  role: string
  display_name: string
  call_ready: boolean
}

type Props = {
  lead: CallLead
  onUpdated: (lead: Lead) => void
}

const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/

export default function LeadCallReadinessPanel({ lead, onUpdated }: Props) {
  const [members, setMembers] = useState<MemberDirectoryRow[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState(lead.phone_e164 || '')
  const [ownerUserId, setOwnerUserId] = useState(lead.owner_user_id || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setPhone(lead.phone_e164 || '')
    setOwnerUserId(lead.owner_user_id || '')
  }, [lead.id, lead.owner_user_id, lead.phone_e164])

  useEffect(() => {
    let active = true

    async function loadMembers() {
      if (!supabase || !lead.workspace_id) return
      setLoadingMembers(true)
      setError(null)

      const db = supabase as unknown as SupabaseClient
      const { data, error: directoryError } = await db.rpc('list_workspace_member_directory', {
        p_workspace_id: lead.workspace_id,
      })

      if (!active) return
      if (directoryError) {
        setMembers([])
        setError('Assigned-rep options could not be loaded.')
      } else {
        setMembers((data || []) as MemberDirectoryRow[])
      }
      setLoadingMembers(false)
    }

    void loadMembers()
    return () => { active = false }
  }, [lead.workspace_id])

  const assignedMember = useMemo(
    () => members.find((member) => member.user_id === (lead.owner_user_id || ownerUserId)) || null,
    [lead.owner_user_id, members, ownerUserId],
  )

  const hasLeadPhone = Boolean(lead.phone_e164 && E164_PATTERN.test(lead.phone_e164))
  const callReady = Boolean(hasLeadPhone && lead.owner_user_id && assignedMember?.call_ready)

  async function saveCallDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !lead.workspace_id || saving) return

    const normalizedPhone = phone.trim()
    if (normalizedPhone && !E164_PATTERN.test(normalizedPhone)) {
      setError('Use international E.164 format, for example +15551234567.')
      return
    }

    setSaving(true)
    setError(null)
    setNotice(null)

    const db = supabase as unknown as SupabaseClient
    const { data, error: updateError } = await db
      .from('leads')
      .update({
        phone_e164: normalizedPhone || null,
        owner_user_id: ownerUserId || null,
      })
      .eq('id', lead.id)
      .eq('workspace_id', lead.workspace_id)
      .select('*')
      .single()

    setSaving(false)

    if (updateError || !data) {
      setError(updateError?.message || 'Call-readiness details could not be saved.')
      return
    }

    setEditing(false)
    setNotice('Call-readiness details saved.')
    onUpdated(data as Lead)
  }

  return (
    <section className="lead-drawer-section">
      <div className="lead-section-heading">
        <span className="spark-badge">☎</span>
        <div>
          <span className="mini-label">AI CALL READINESS · CALLING OFF</span>
          <h3>Phone & assigned rep</h3>
        </div>
      </div>

      {!editing ? (
        <>
          <div className="lead-detail-grid">
            <LeadCallDetail label="Lead phone" value={lead.phone_e164 || 'Not provided'} />
            <LeadCallDetail label="Assigned rep" value={assignedMember?.display_name || (lead.owner_user_id ? 'Workspace member' : 'Not assigned')} />
            <LeadCallDetail label="Rep transfer profile" value={assignedMember?.call_ready ? 'Ready' : lead.owner_user_id ? 'Not ready' : 'Assign a rep first'} />
            <LeadCallDetail label="AI call status" value={callReady ? 'Call ready · disabled' : 'Setup incomplete'} />
          </div>
          <p className="field-helper">
            “Call ready” only confirms CRM data is prepared. Smart CRM still cannot place an AI call in this rollout gate.
          </p>
          <div className="lead-drawer-actions">
            <button className="button secondary" type="button" onClick={() => { setEditing(true); setNotice(null); setError(null) }}>
              Edit call details
            </button>
          </div>
        </>
      ) : (
        <form className="lead-edit-form" onSubmit={saveCallDetails}>
          <div className="lead-edit-grid">
            <label>
              <span>Lead phone · E.164</span>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+15551234567"
                inputMode="tel"
                autoComplete="tel"
                maxLength={16}
              />
              <small className="field-helper">Include + and country code. No spaces or punctuation.</small>
            </label>
            <label>
              <span>Assigned rep</span>
              <select value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} disabled={loadingMembers}>
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.display_name} · {member.role}{member.call_ready ? ' · Call ready' : ''}
                  </option>
                ))}
              </select>
              <small className="field-helper">Only members of this workspace can be assigned.</small>
            </label>
          </div>
          <div className="lead-edit-actions">
            <button className="button secondary" type="button" onClick={() => {
              setEditing(false)
              setPhone(lead.phone_e164 || '')
              setOwnerUserId(lead.owner_user_id || '')
              setError(null)
            }} disabled={saving}>Cancel</button>
            <button className="button primary" type="submit" disabled={saving || loadingMembers}>{saving ? 'Saving…' : 'Save call details'}</button>
          </div>
        </form>
      )}

      {error ? <div className="lead-save-error" role="alert">{error}</div> : null}
      {notice ? <div className="lead-save-success" role="status">✓ {notice}</div> : null}
    </section>
  )
}

function LeadCallDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="lead-detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
