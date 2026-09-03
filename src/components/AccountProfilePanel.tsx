import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../workspace-context'

type ProfileDraft = {
  firstName: string
  lastName: string
  displayName: string
  email: string
}

const EMPTY_PROFILE: ProfileDraft = {
  firstName: '',
  lastName: '',
  displayName: '',
  email: '',
}

const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key]
  return typeof value === 'string' ? value.trim() : ''
}

function profileFromMetadata(metadata: Record<string, unknown>, email: string) {
  const preferredName = metadataString(metadata, 'display_name') || metadataString(metadata, 'full_name') || metadataString(metadata, 'name')
  const parts = (metadataString(metadata, 'full_name') || preferredName).split(/\s+/).filter(Boolean)
  const firstName = metadataString(metadata, 'first_name') || parts[0] || ''
  const lastName = metadataString(metadata, 'last_name') || parts.slice(1).join(' ')
  const displayName = preferredName

  return { firstName, lastName, displayName, email }
}

export default function AccountProfilePanel() {
  const { activeWorkspace } = useWorkspace()
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_PROFILE)
  const [sourceMetadata, setSourceMetadata] = useState<Record<string, unknown>>({})
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [transferPhone, setTransferPhone] = useState('')
  const [acceptsWarmTransfers, setAcceptsWarmTransfers] = useState(false)
  const [callProfileLoading, setCallProfileLoading] = useState(true)
  const [callProfileSaving, setCallProfileSaving] = useState(false)
  const [callProfileError, setCallProfileError] = useState<string | null>(null)
  const [callProfileNotice, setCallProfileNotice] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadProfile() {
      if (!supabase) {
        if (active) {
          setError('Account profile is unavailable right now.')
          setCallProfileError('Warm transfer profile is unavailable right now.')
          setLoading(false)
          setCallProfileLoading(false)
        }
        return
      }

      const { data, error: userError } = await supabase.auth.getUser()
      if (!active) return

      if (userError || !data.user) {
        setError('Account profile could not be loaded.')
        setCallProfileError('Warm transfer profile could not be loaded.')
        setLoading(false)
        setCallProfileLoading(false)
        return
      }

      const metadata = (data.user.user_metadata || {}) as Record<string, unknown>
      setUserId(data.user.id)
      setSourceMetadata(metadata)
      setDraft(profileFromMetadata(metadata, data.user.email || ''))
      setLoading(false)

      const db = supabase as unknown as SupabaseClient
      const { data: callProfile, error: callProfileLoadError } = await db
        .from('workspace_member_call_profiles')
        .select('warm_transfer_phone_e164, accepts_warm_transfers')
        .eq('workspace_id', activeWorkspace.workspaceId)
        .eq('user_id', data.user.id)
        .maybeSingle()

      if (!active) return
      if (callProfileLoadError) {
        setCallProfileError('Warm transfer profile could not be loaded.')
      } else {
        setTransferPhone(callProfile?.warm_transfer_phone_e164 ? String(callProfile.warm_transfer_phone_e164) : '')
        setAcceptsWarmTransfers(Boolean(callProfile?.accepts_warm_transfers))
      }
      setCallProfileLoading(false)
    }

    void loadProfile()
    return () => {
      active = false
    }
  }, [activeWorkspace.workspaceId])

  function setField(field: keyof ProfileDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function saveProfile() {
    if (!supabase || saving) return

    const firstName = draft.firstName.trim()
    const lastName = draft.lastName.trim()
    const legalName = [firstName, lastName].filter(Boolean).join(' ').trim()
    const displayName = draft.displayName.trim() || legalName

    if (!displayName) {
      setError('Add a display name or at least a first name before saving.')
      return
    }
    if ([firstName, lastName, displayName].some((value) => value.length > 120) || legalName.length > 240) {
      setError('Profile name fields are too long.')
      return
    }

    setSaving(true)
    setError(null)
    setNotice(null)

    const nextMetadata = {
      ...sourceMetadata,
      first_name: firstName || null,
      last_name: lastName || null,
      full_name: displayName,
      name: displayName,
      display_name: displayName,
    }

    const { data, error: updateError } = await supabase.auth.updateUser({ data: nextMetadata })
    setSaving(false)

    if (updateError || !data.user) {
      setError(updateError?.message || 'Profile could not be saved.')
      return
    }

    const savedMetadata = (data.user.user_metadata || nextMetadata) as Record<string, unknown>
    setSourceMetadata(savedMetadata)
    setDraft(profileFromMetadata(savedMetadata, data.user.email || draft.email))
    setEditing(false)
    setNotice('Profile saved. Refreshing your account name…')
    window.setTimeout(() => window.location.reload(), 650)
  }

  async function saveCallProfile() {
    if (!supabase || !userId || callProfileSaving) return

    const normalizedPhone = transferPhone.trim()
    if (normalizedPhone && !E164_PATTERN.test(normalizedPhone)) {
      setCallProfileError('Use international E.164 format, for example +15551234567.')
      return
    }
    if (acceptsWarmTransfers && !normalizedPhone) {
      setCallProfileError('Add a transfer phone before enabling warm transfers.')
      return
    }

    setCallProfileSaving(true)
    setCallProfileError(null)
    setCallProfileNotice(null)

    const db = supabase as unknown as SupabaseClient
    const { error: saveError } = await db
      .from('workspace_member_call_profiles')
      .upsert({
        workspace_id: activeWorkspace.workspaceId,
        user_id: userId,
        warm_transfer_phone_e164: normalizedPhone || null,
        accepts_warm_transfers: acceptsWarmTransfers,
      }, { onConflict: 'workspace_id,user_id' })

    setCallProfileSaving(false)
    if (saveError) {
      setCallProfileError(saveError.message || 'Warm transfer profile could not be saved.')
      return
    }

    setTransferPhone(normalizedPhone)
    setCallProfileNotice(acceptsWarmTransfers ? 'Warm transfer profile is ready.' : 'Warm transfer profile saved. Transfers remain disabled for you.')
  }

  const summaryName = draft.displayName || [draft.firstName, draft.lastName].filter(Boolean).join(' ') || 'Name not set'
  const transferReady = Boolean(acceptsWarmTransfers && transferPhone && E164_PATTERN.test(transferPhone))

  return (
    <article className="panel settings-section-card compact-card account-profile-card">
      <div className="profile-card-heading">
        <div>
          <span className="mini-label">YOUR PROFILE</span>
          <h2>Account details</h2>
        </div>
        {!loading && !editing ? (
          <button className="button tertiary" type="button" onClick={() => { setEditing(true); setNotice(null); setError(null) }}>
            Edit profile
          </button>
        ) : null}
      </div>

      {loading ? <p className="settings-muted">Loading account profile…</p> : null}

      {!loading && !editing ? (
        <>
          <div className="owner-settings-row"><span>Name</span><strong>{summaryName}</strong></div>
          <div className="owner-settings-row"><span>Email</span><strong>{draft.email || 'Unavailable'}</strong></div>
          {!draft.firstName ? <div className="settings-inline-message info">Add your first name so greetings and account identity can display more naturally.</div> : null}
        </>
      ) : null}

      {!loading && editing ? (
        <div className="profile-edit-form">
          <div className="profile-field-row">
            <label><span>First name</span><input value={draft.firstName} onChange={(event) => setField('firstName', event.target.value)} autoComplete="given-name" maxLength={120} /></label>
            <label><span>Last name</span><input value={draft.lastName} onChange={(event) => setField('lastName', event.target.value)} autoComplete="family-name" maxLength={120} /></label>
          </div>
          <label><span>Display name</span><input value={draft.displayName} onChange={(event) => setField('displayName', event.target.value)} placeholder="How your name appears in Smart CRM" maxLength={120} /></label>
          <label><span>Email</span><input value={draft.email} disabled readOnly /></label>
          <div className="profile-actions">
            <button className="button secondary" type="button" onClick={() => { setEditing(false); setError(null) }} disabled={saving}>Cancel</button>
            <button className="button primary" type="button" onClick={() => void saveProfile()} disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
          </div>
        </div>
      ) : null}

      {error ? <div className="settings-inline-message error">{error}</div> : null}
      {notice ? <div className="settings-inline-message success">{notice}</div> : null}

      <div className="profile-edit-form" style={{ marginTop: '1.25rem' }}>
        <div className="profile-card-heading">
          <div>
            <span className="mini-label">AI CALL ROUTING · CALLING OFF</span>
            <h2>Warm transfer profile</h2>
          </div>
          {!callProfileLoading ? <span className={`policy-state ${transferReady ? 'active' : 'off'}`}>{transferReady ? 'Ready' : 'Not ready'}</span> : null}
        </div>
        <p className="settings-muted">This private number is used only as your future warm-transfer destination. It is not shown in the workspace member directory.</p>

        {callProfileLoading ? <p className="settings-muted">Loading warm transfer profile…</p> : (
          <>
            <label>
              <span>Transfer phone · E.164</span>
              <input value={transferPhone} onChange={(event) => setTransferPhone(event.target.value)} placeholder="+15551234567" inputMode="tel" autoComplete="tel" maxLength={16} />
            </label>
            <label className="owner-settings-row" style={{ alignItems: 'center' }}>
              <span>Accept future AI warm transfers</span>
              <input type="checkbox" checked={acceptsWarmTransfers} onChange={(event) => setAcceptsWarmTransfers(event.target.checked)} />
            </label>
            <div className="settings-inline-message info">Saving this profile does not enable AI calling. Provider dispatch remains disabled until the compliance and controlled-call gates are approved.</div>
            <div className="profile-actions">
              <button className="button primary" type="button" onClick={() => void saveCallProfile()} disabled={callProfileSaving}>
                {callProfileSaving ? 'Saving…' : 'Save call profile'}
              </button>
            </div>
          </>
        )}

        {callProfileError ? <div className="settings-inline-message error">{callProfileError}</div> : null}
        {callProfileNotice ? <div className="settings-inline-message success">{callProfileNotice}</div> : null}
      </div>
    </article>
  )
}
