import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key]
  return typeof value === 'string' ? value.trim() : ''
}

function profileFromMetadata(metadata: Record<string, unknown>, email: string) {
  const preferredName = metadataString(metadata, 'full_name') || metadataString(metadata, 'name') || metadataString(metadata, 'display_name')
  const parts = preferredName ? preferredName.split(/\s+/) : []
  const firstName = metadataString(metadata, 'first_name') || parts[0] || ''
  const lastName = metadataString(metadata, 'last_name') || parts.slice(1).join(' ')
  const displayName = metadataString(metadata, 'display_name') || preferredName

  return { firstName, lastName, displayName, email }
}

export default function AccountProfilePanel() {
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_PROFILE)
  const [sourceMetadata, setSourceMetadata] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadProfile() {
      if (!supabase) {
        if (active) {
          setError('Account profile is unavailable right now.')
          setLoading(false)
        }
        return
      }

      const { data, error: userError } = await supabase.auth.getUser()
      if (!active) return

      if (userError || !data.user) {
        setError('Account profile could not be loaded.')
        setLoading(false)
        return
      }

      const metadata = (data.user.user_metadata || {}) as Record<string, unknown>
      setSourceMetadata(metadata)
      setDraft(profileFromMetadata(metadata, data.user.email || ''))
      setLoading(false)
    }

    void loadProfile()
    return () => {
      active = false
    }
  }, [])

  function setField(field: keyof ProfileDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function saveProfile() {
    if (!supabase || saving) return

    const firstName = draft.firstName.trim()
    const lastName = draft.lastName.trim()
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()
    const displayName = draft.displayName.trim() || fullName

    if (!displayName) {
      setError('Add a display name or at least a first name before saving.')
      return
    }
    if ([firstName, lastName, displayName].some((value) => value.length > 120)) {
      setError('Profile name fields must be 120 characters or less.')
      return
    }

    setSaving(true)
    setError(null)
    setNotice(null)

    const nextMetadata = {
      ...sourceMetadata,
      first_name: firstName || null,
      last_name: lastName || null,
      full_name: fullName || displayName,
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

  const summaryName = draft.displayName || [draft.firstName, draft.lastName].filter(Boolean).join(' ') || 'Name not set'

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
    </article>
  )
}
