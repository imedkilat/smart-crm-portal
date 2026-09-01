import { useEffect, useMemo, useState, type CSSProperties, type ChangeEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import '../workspace-branding.css'
import { useWorkspace } from '../workspace-context'

const BRAND_BUCKET = 'workspace-brand-assets'
const MAX_LOGO_BYTES = 2 * 1024 * 1024
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type BrandingRow = {
  workspace_id: string
  company_name: string
  logo_path: string | null
  primary_color: string
  secondary_color: string
  website_url: string | null
  sender_name: string | null
  reply_to_email: string | null
  email_signature: string | null
  created_at: string
  updated_at: string
}

type BrandingDatabase = {
  public: Database['public'] & {
    Tables: Database['public']['Tables'] & {
      workspace_branding: {
        Row: BrandingRow
        Insert: {
          workspace_id: string
          company_name: string
          logo_path?: string | null
          primary_color?: string
          secondary_color?: string
          website_url?: string | null
          sender_name?: string | null
          reply_to_email?: string | null
          email_signature?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<BrandingRow>
        Relationships: []
      }
    }
  }
}

type BrandDraft = Pick<BrandingRow, 'company_name' | 'primary_color' | 'secondary_color' | 'website_url' | 'sender_name' | 'reply_to_email' | 'email_signature'>

const EMPTY_DRAFT: BrandDraft = {
  company_name: '',
  primary_color: '#2493F1',
  secondary_color: '#0F172A',
  website_url: null,
  sender_name: null,
  reply_to_email: null,
  email_signature: null,
}

function optionalValue(value: string | null) {
  const trimmed = (value || '').trim()
  return trimmed || null
}

function isHttpUrl(value: string | null) {
  if (!value) return true
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function fileExtension(file: File) {
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/jpeg') return 'jpg'
  if (file.type === 'image/webp') return 'webp'
  return null
}

function isMissingBrandingSchema(error: { code?: string; message?: string } | null) {
  if (!error) return false
  const message = (error.message || '').toLowerCase()
  return error.code === '42P01' || error.code === 'PGRST205' || message.includes('workspace_branding')
}

export default function WorkspaceBrandingPanel() {
  const { activeWorkspace } = useWorkspace()
  const brandingClient = supabase as unknown as SupabaseClient<BrandingDatabase> | null
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspaceRole, setWorkspaceRole] = useState<string | null>(null)
  const [workspaceResolutionError, setWorkspaceResolutionError] = useState<string | null>(null)
  const [draft, setDraft] = useState<BrandDraft>(EMPTY_DRAFT)
  const [logoPath, setLogoPath] = useState<string | null>(null)
  const [schemaReady, setSchemaReady] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const canManage = workspaceRole === 'owner' || workspaceRole === 'admin'

  useEffect(() => {
    let active = true

    async function loadBranding() {
      if (!supabase || !brandingClient) {
        if (active) {
          setError('Supabase is not configured.')
          setLoading(false)
        }
        return
      }

      setLoading(true)
      setError(null)
      setNotice(null)
      setWorkspaceResolutionError(null)

      const nextWorkspaceId = activeWorkspace.workspaceId
      setWorkspaceId(nextWorkspaceId)
      setWorkspaceRole(activeWorkspace.role)

      const brandingResult = await brandingClient.from('workspace_branding').select('*').eq('workspace_id', nextWorkspaceId).maybeSingle()

      if (!active) return
      if (brandingResult.error) {
        if (isMissingBrandingSchema(brandingResult.error)) {
          setSchemaReady(false)
          setDraft({ ...EMPTY_DRAFT, company_name: activeWorkspace.name })
          setLoading(false)
          return
        }
        setError(brandingResult.error.message)
        setLoading(false)
        return
      }

      setSchemaReady(true)
      const row = brandingResult.data as BrandingRow | null
      setDraft({
        company_name: row?.company_name || activeWorkspace.name,
        primary_color: row?.primary_color || EMPTY_DRAFT.primary_color,
        secondary_color: row?.secondary_color || EMPTY_DRAFT.secondary_color,
        website_url: row?.website_url || null,
        sender_name: row?.sender_name || null,
        reply_to_email: row?.reply_to_email || null,
        email_signature: row?.email_signature || null,
      })
      setLogoPath(row?.logo_path || null)
      setLoading(false)
    }

    void loadBranding()
    return () => { active = false }
  }, [activeWorkspace.name, activeWorkspace.role, activeWorkspace.workspaceId, brandingClient])

  const logoUrl = useMemo(() => {
    if (!supabase || !logoPath) return null
    return supabase.storage.from(BRAND_BUCKET).getPublicUrl(logoPath).data.publicUrl
  }, [logoPath])

  const previewPrimary = HEX_COLOR.test(draft.primary_color) ? draft.primary_color : EMPTY_DRAFT.primary_color
  const previewSecondary = HEX_COLOR.test(draft.secondary_color) ? draft.secondary_color : EMPTY_DRAFT.secondary_color
  const previewStyle = { '--brand-primary': previewPrimary, '--brand-secondary': previewSecondary } as CSSProperties

  function setField<K extends keyof BrandDraft>(key: K, value: BrandDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setNotice(null)
  }

  async function saveBranding() {
    if (!brandingClient || !workspaceId || !schemaReady || !canManage) return

    const companyName = draft.company_name.trim()
    const websiteUrl = optionalValue(draft.website_url)
    const replyToEmail = optionalValue(draft.reply_to_email)

    if (!companyName) return setError('Company name is required.')
    if (!HEX_COLOR.test(draft.primary_color) || !HEX_COLOR.test(draft.secondary_color)) return setError('Brand colors must use a six-digit hex value like #2493F1.')
    if (!isHttpUrl(websiteUrl)) return setError('Website must start with http:// or https://.')
    if (replyToEmail && !EMAIL_PATTERN.test(replyToEmail)) return setError('Reply-to email is not valid.')

    setSaving(true)
    setError(null)
    setNotice(null)

    const result = await brandingClient
      .from('workspace_branding')
      .update({
        company_name: companyName,
        primary_color: draft.primary_color.toUpperCase(),
        secondary_color: draft.secondary_color.toUpperCase(),
        website_url: websiteUrl,
        sender_name: optionalValue(draft.sender_name),
        reply_to_email: replyToEmail,
        email_signature: optionalValue(draft.email_signature),
      })
      .eq('workspace_id', workspaceId)
      .select('*')
      .single()

    setSaving(false)
    if (result.error) return setError(result.error.message)

    const row = result.data as BrandingRow
    setDraft({
      company_name: row.company_name,
      primary_color: row.primary_color,
      secondary_color: row.secondary_color,
      website_url: row.website_url,
      sender_name: row.sender_name,
      reply_to_email: row.reply_to_email,
      email_signature: row.email_signature,
    })
    setLogoPath(row.logo_path)
    setNotice('Brand profile saved.')
  }

  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !supabase || !brandingClient || !workspaceId || !schemaReady || !canManage) return

    const extension = fileExtension(file)
    if (!extension) return setError('Use a PNG, JPG or WebP logo.')
    if (file.size > MAX_LOGO_BYTES) return setError('Logo files must be 2 MB or smaller.')

    setUploadingLogo(true)
    setError(null)
    setNotice(null)

    const nextPath = `${workspaceId}/logo.${extension}`
    const previousPath = logoPath
    const uploadResult = await supabase.storage.from(BRAND_BUCKET).upload(nextPath, file, {
      cacheControl: '3600', contentType: file.type, upsert: true,
    })

    if (uploadResult.error) {
      setUploadingLogo(false)
      setError(uploadResult.error.message.toLowerCase().includes('bucket')
        ? 'Logo storage is not provisioned yet. The branding profile can still be saved without a logo.'
        : uploadResult.error.message)
      return
    }

    const updateResult = await brandingClient
      .from('workspace_branding')
      .update({ logo_path: nextPath })
      .eq('workspace_id', workspaceId)
      .select('logo_path')
      .single()

    setUploadingLogo(false)
    if (updateResult.error) {
      if (previousPath !== nextPath) void supabase.storage.from(BRAND_BUCKET).remove([nextPath])
      return setError(updateResult.error.message)
    }

    setLogoPath(nextPath)
    setNotice('Logo updated.')
    if (previousPath && previousPath !== nextPath) void supabase.storage.from(BRAND_BUCKET).remove([previousPath])
  }

  async function removeLogo() {
    if (!supabase || !brandingClient || !workspaceId || !logoPath || !schemaReady || !canManage) return
    const previousPath = logoPath
    setUploadingLogo(true)
    setError(null)
    setNotice(null)

    const updateResult = await brandingClient.from('workspace_branding').update({ logo_path: null }).eq('workspace_id', workspaceId)
    if (updateResult.error) {
      setUploadingLogo(false)
      setError(updateResult.error.message)
      return
    }

    setLogoPath(null)
    const removeResult = await supabase.storage.from(BRAND_BUCKET).remove([previousPath])
    setUploadingLogo(false)
    if (removeResult.error) {
      setNotice('Logo removed from the brand profile. The old Storage object may need cleanup.')
      return
    }
    setNotice('Logo removed.')
  }

  return (
    <section className="panel workspace-branding-panel">
      <div className="branding-heading">
        <div>
          <span className="mini-label">CLIENT IDENTITY</span>
          <h2>Workspace branding</h2>
          <p>Define the company identity that future email templates, chatbot surfaces and client-facing previews can reuse.</p>
        </div>
        <span className={`branding-access-pill ${canManage ? 'editable' : 'readonly'}`}>{canManage ? 'Owner / admin controls' : 'Read only'}</span>
      </div>

      {loading && <div className="branding-state">Loading workspace brand profile…</div>}
      {!loading && workspaceResolutionError && <div className="branding-state pending">{workspaceResolutionError}</div>}
      {!loading && !workspaceResolutionError && !schemaReady && <div className="branding-state pending">Branding source is ready, but the production `workspace_branding` migration has not been rolled out yet. The rest of Settings remains available.</div>}

      {!loading && !workspaceResolutionError && schemaReady && (
        <div className="branding-grid">
          <div className="branding-form">
            <div className="branding-logo-row">
              <div className="branding-logo-preview" style={{ background: previewPrimary }}>
                {logoUrl ? <img src={logoUrl} alt="" /> : <span>{(draft.company_name || 'W').charAt(0).toUpperCase()}</span>}
              </div>
              <div className="branding-logo-copy">
                <strong>Company logo</strong>
                <p>PNG, JPG or WebP · max 2 MB. Logos are intended to be public brand assets.</p>
                <div className="branding-inline-actions">
                  <label className={`button secondary branding-upload-button ${!canManage ? 'disabled' : ''}`}>
                    {uploadingLogo ? 'Uploading…' : logoPath ? 'Replace logo' : 'Upload logo'}
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadLogo(event)} disabled={!canManage || uploadingLogo} />
                  </label>
                  {logoPath && <button className="button tertiary" type="button" onClick={() => void removeLogo()} disabled={!canManage || uploadingLogo}>Remove</button>}
                </div>
              </div>
            </div>

            <div className="branding-field-grid">
              <label className="branding-field full"><span>Company name</span><input value={draft.company_name} onChange={(event) => setField('company_name', event.target.value)} placeholder="Acme Roofing" maxLength={160} disabled={!canManage} /></label>
              <label className="branding-field"><span>Primary color</span><div className="branding-color-control"><input className="branding-color-picker" type="color" value={previewPrimary} onChange={(event) => setField('primary_color', event.target.value.toUpperCase())} disabled={!canManage} /><input value={draft.primary_color} onChange={(event) => setField('primary_color', event.target.value)} placeholder="#2493F1" maxLength={7} disabled={!canManage} /></div></label>
              <label className="branding-field"><span>Secondary color</span><div className="branding-color-control"><input className="branding-color-picker" type="color" value={previewSecondary} onChange={(event) => setField('secondary_color', event.target.value.toUpperCase())} disabled={!canManage} /><input value={draft.secondary_color} onChange={(event) => setField('secondary_color', event.target.value)} placeholder="#0F172A" maxLength={7} disabled={!canManage} /></div></label>
              <label className="branding-field full"><span>Website</span><input value={draft.website_url || ''} onChange={(event) => setField('website_url', event.target.value || null)} placeholder="https://example.com" maxLength={500} disabled={!canManage} /></label>
              <label className="branding-field"><span>Default sender name</span><input value={draft.sender_name || ''} onChange={(event) => setField('sender_name', event.target.value || null)} placeholder="Sarah from Acme" maxLength={160} disabled={!canManage} /></label>
              <label className="branding-field"><span>Reply-to email</span><input type="email" value={draft.reply_to_email || ''} onChange={(event) => setField('reply_to_email', event.target.value || null)} placeholder="hello@example.com" maxLength={320} disabled={!canManage} /></label>
              <label className="branding-field full"><span>Email signature</span><textarea value={draft.email_signature || ''} onChange={(event) => setField('email_signature', event.target.value || null)} placeholder={'Best,\nThe Acme Team'} maxLength={2000} rows={4} disabled={!canManage} /></label>
            </div>

            {error && <div className="branding-feedback error">{error}</div>}
            {notice && <div className="branding-feedback success">{notice}</div>}
            <div className="branding-save-row">
              <p>{canManage ? 'Saving updates the reusable workspace brand profile only. No email is sent from this screen.' : 'Only workspace owners and admins can change brand settings.'}</p>
              <button className="button primary" type="button" onClick={() => void saveBranding()} disabled={!canManage || saving}>{saving ? 'Saving…' : 'Save branding'}</button>
            </div>
          </div>

          <aside className="brand-preview-card" style={previewStyle}>
            <div className="brand-preview-kicker">LIVE PREVIEW</div>
            <div className="brand-preview-header"><div className="brand-preview-logo">{logoUrl ? <img src={logoUrl} alt="" /> : <span>{(draft.company_name || 'W').charAt(0).toUpperCase()}</span>}</div><div><strong>{draft.company_name || 'Your company'}</strong><span>{draft.website_url || 'yourcompany.com'}</span></div></div>
            <div className="brand-preview-email"><div className="brand-preview-email-top"><span>FOLLOW-UP PREVIEW</span><i /></div><p>Hi Jordan,</p><p>Just checking in on your request. If you still need help, reply here and our team will pick it up.</p><div className="brand-preview-signature">{draft.email_signature || `Best,\n${draft.sender_name || draft.company_name || 'Your team'}`}</div></div>
            <div className="brand-preview-footer"><span>From</span><strong>{draft.sender_name || draft.company_name || 'Your company'}</strong><small>{draft.reply_to_email || 'reply-to not set'}</small></div>
          </aside>
        </div>
      )}
    </section>
  )
}
