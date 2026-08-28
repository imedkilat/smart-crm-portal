import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import {
  SAMPLE_TEMPLATE_CONTEXT,
  TEMPLATE_VARIABLES,
  extractTemplateVariables,
  renderTemplateText,
  validateMessageTemplate,
  type MessageTemplateContext,
  type TemplateVariableKey,
} from '../lib/messageTemplates'
import '../message-templates.css'

const BRAND_BUCKET = 'workspace-brand-assets'

type MessageTemplateRow = {
  id: string
  workspace_id: string
  template_key: string
  name: string
  channel: 'email'
  purpose: 'follow_up' | 're_engagement' | 'custom'
  subject_template: string
  body_template: string
  tone: 'professional' | 'friendly' | 'warm' | 'concise'
  is_enabled: boolean
  is_default: boolean
  version: number
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

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
}

type TemplateDatabase = {
  public: Database['public'] & {
    Tables: Database['public']['Tables'] & {
      message_templates: {
        Row: MessageTemplateRow
        Insert: {
          workspace_id: string
          template_key: string
          name: string
          channel?: 'email'
          purpose?: MessageTemplateRow['purpose']
          subject_template: string
          body_template: string
          tone?: MessageTemplateRow['tone']
          is_enabled?: boolean
          is_default?: boolean
        }
        Update: Partial<Pick<MessageTemplateRow,
          'name' | 'purpose' | 'subject_template' | 'body_template' | 'tone' | 'is_enabled' | 'is_default'
        >>
        Relationships: []
      }
      workspace_branding: {
        Row: BrandingRow
        Insert: BrandingRow
        Update: Partial<BrandingRow>
        Relationships: []
      }
    }
  }
}

type TemplateDraft = Pick<MessageTemplateRow,
  'id' | 'template_key' | 'name' | 'purpose' | 'subject_template' | 'body_template' | 'tone' | 'is_enabled' | 'is_default' | 'version'
>

const EMPTY_DRAFT: TemplateDraft = {
  id: '',
  template_key: '',
  name: '',
  purpose: 'custom',
  subject_template: '',
  body_template: '',
  tone: 'friendly',
  is_enabled: true,
  is_default: false,
  version: 1,
}

function isMissingTemplateSchema(error: { code?: string; message?: string } | null) {
  if (!error) return false
  const message = (error.message || '').toLowerCase()
  return error.code === '42P01' || error.code === 'PGRST205' || message.includes('message_templates')
}

function purposeLabel(purpose: MessageTemplateRow['purpose']) {
  if (purpose === 'follow_up') return 'Follow-up'
  if (purpose === 're_engagement') return 'Re-engagement'
  return 'Custom'
}

function newTemplateDraft(): TemplateDraft {
  const randomKey = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    : Date.now().toString(36)

  return {
    ...EMPTY_DRAFT,
    template_key: `custom-${randomKey}`,
    name: 'New email template',
    subject_template: 'Following up, {{lead.first_name}}',
    body_template: 'Hi {{lead.first_name}},\n\nThanks for reaching out to {{workspace.company_name}}.\n\n{{workspace.email_signature}}',
  }
}

export default function MessageTemplatesPanel() {
  const client = supabase as unknown as SupabaseClient<TemplateDatabase> | null
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspaceRole, setWorkspaceRole] = useState<string | null>(null)
  const [workspaceResolutionError, setWorkspaceResolutionError] = useState<string | null>(null)
  const [branding, setBranding] = useState<BrandingRow | null>(null)
  const [templates, setTemplates] = useState<MessageTemplateRow[]>([])
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_DRAFT)
  const [activeField, setActiveField] = useState<'subject' | 'body'>('body')
  const [schemaReady, setSchemaReady] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const canManage = workspaceRole === 'owner' || workspaceRole === 'admin'

  useEffect(() => {
    let active = true

    async function loadTemplates() {
      if (!supabase || !client) {
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

      const { data: userData, error: userError } = await supabase.auth.getUser()
      const user = userData.user
      if (!active) return

      if (userError || !user) {
        setError(userError?.message || 'Could not resolve the current user.')
        setLoading(false)
        return
      }

      const membershipResult = await supabase
        .from('workspace_members')
        .select('workspace_id, role')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(2)

      if (!active) return
      if (membershipResult.error) {
        setError(membershipResult.error.message)
        setLoading(false)
        return
      }

      const memberships = membershipResult.data || []
      if (memberships.length === 0) {
        setWorkspaceResolutionError('No workspace membership was found for this account.')
        setLoading(false)
        return
      }

      if (memberships.length > 1) {
        setWorkspaceResolutionError('This account belongs to multiple workspaces. Choose an active workspace before editing message templates. Smart CRM will not guess which tenant you meant.')
        setLoading(false)
        return
      }

      const membership = memberships[0]
      const nextWorkspaceId = membership.workspace_id
      setWorkspaceId(nextWorkspaceId)
      setWorkspaceRole(membership.role || null)

      const [brandingResult, templateResult] = await Promise.all([
        client.from('workspace_branding').select('*').eq('workspace_id', nextWorkspaceId).maybeSingle(),
        client
          .from('message_templates')
          .select('*')
          .eq('workspace_id', nextWorkspaceId)
          .order('purpose', { ascending: true })
          .order('created_at', { ascending: true }),
      ])

      if (!active) return
      if (templateResult.error) {
        if (isMissingTemplateSchema(templateResult.error)) {
          setSchemaReady(false)
          setBranding((brandingResult.data as BrandingRow | null) || null)
          setLoading(false)
          return
        }
        setError(templateResult.error.message)
        setLoading(false)
        return
      }

      setSchemaReady(true)
      setBranding((brandingResult.data as BrandingRow | null) || null)
      const rows = (templateResult.data || []) as MessageTemplateRow[]
      setTemplates(rows)

      if (rows.length) {
        setSelectedId(rows[0].id)
        setDraft({
          id: rows[0].id,
          template_key: rows[0].template_key,
          name: rows[0].name,
          purpose: rows[0].purpose,
          subject_template: rows[0].subject_template,
          body_template: rows[0].body_template,
          tone: rows[0].tone,
          is_enabled: rows[0].is_enabled,
          is_default: rows[0].is_default,
          version: rows[0].version,
        })
      } else {
        setSelectedId('new')
        setDraft(newTemplateDraft())
      }

      setLoading(false)
    }

    void loadTemplates()
    return () => { active = false }
  }, [client])

  const logoUrl = useMemo(() => {
    if (!supabase || !branding?.logo_path) return null
    return supabase.storage.from(BRAND_BUCKET).getPublicUrl(branding.logo_path).data.publicUrl
  }, [branding?.logo_path])

  const previewContext = useMemo<MessageTemplateContext>(() => ({
    ...SAMPLE_TEMPLATE_CONTEXT,
    workspace: {
      company_name: branding?.company_name || SAMPLE_TEMPLATE_CONTEXT.workspace.company_name,
      website_url: branding?.website_url || SAMPLE_TEMPLATE_CONTEXT.workspace.website_url,
      sender_name: branding?.sender_name || branding?.company_name || SAMPLE_TEMPLATE_CONTEXT.workspace.sender_name,
      reply_to_email: branding?.reply_to_email || SAMPLE_TEMPLATE_CONTEXT.workspace.reply_to_email,
      email_signature: branding?.email_signature || `Best,\n${branding?.sender_name || branding?.company_name || SAMPLE_TEMPLATE_CONTEXT.workspace.sender_name}`,
    },
  }), [branding])

  const subjectValidation = useMemo(() => validateMessageTemplate(draft.subject_template), [draft.subject_template])
  const bodyValidation = useMemo(() => validateMessageTemplate(draft.body_template), [draft.body_template])
  const usedVariables = useMemo(
    () => [...new Set([...extractTemplateVariables(draft.subject_template), ...extractTemplateVariables(draft.body_template)])],
    [draft.subject_template, draft.body_template],
  )

  const previewSubject = useMemo(() => {
    if (!subjectValidation.valid) return 'Fix template variables to preview the subject.'
    try { return renderTemplateText(draft.subject_template, previewContext) } catch { return 'Preview unavailable.' }
  }, [draft.subject_template, previewContext, subjectValidation.valid])

  const previewBody = useMemo(() => {
    if (!bodyValidation.valid) return 'Fix template variables to preview the message.'
    try { return renderTemplateText(draft.body_template, previewContext) } catch { return 'Preview unavailable.' }
  }, [draft.body_template, previewContext, bodyValidation.valid])

  const previewPrimary = branding?.primary_color || '#2493F1'
  const previewSecondary = branding?.secondary_color || '#0F172A'
  const previewStyle = {
    '--template-primary': previewPrimary,
    '--template-secondary': previewSecondary,
  } as CSSProperties

  function selectTemplate(row: MessageTemplateRow) {
    setSelectedId(row.id)
    setDraft({
      id: row.id,
      template_key: row.template_key,
      name: row.name,
      purpose: row.purpose,
      subject_template: row.subject_template,
      body_template: row.body_template,
      tone: row.tone,
      is_enabled: row.is_enabled,
      is_default: row.is_default,
      version: row.version,
    })
    setError(null)
    setNotice(null)
  }

  function startNewTemplate() {
    setSelectedId('new')
    setDraft(newTemplateDraft())
    setError(null)
    setNotice(null)
  }

  function setField<K extends keyof TemplateDraft>(key: K, value: TemplateDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setNotice(null)
  }

  function insertVariable(key: TemplateVariableKey) {
    const token = `{{${key}}}`
    if (activeField === 'subject') {
      setField('subject_template', `${draft.subject_template}${draft.subject_template.endsWith(' ') || !draft.subject_template ? '' : ' '}${token}`)
      return
    }

    setField('body_template', `${draft.body_template}${draft.body_template.endsWith('\n') || !draft.body_template ? '' : ' '}${token}`)
  }

  async function saveTemplate() {
    if (!client || !workspaceId || !schemaReady || !canManage) return

    const name = draft.name.trim()
    const subject = draft.subject_template.trim()
    const body = draft.body_template.trim()

    if (!name) return setError('Template name is required.')
    if (!subject) return setError('Email subject is required.')
    if (!body) return setError('Email body is required.')
    if (subject.length > 300) return setError('Subject must be 300 characters or less.')
    if (body.length > 12000) return setError('Body must be 12,000 characters or less.')
    if (!subjectValidation.valid || !bodyValidation.valid) return setError('Fix unknown or malformed template variables before saving.')

    setSaving(true)
    setError(null)
    setNotice(null)

    const editablePayload = {
      name,
      purpose: draft.purpose,
      subject_template: subject,
      body_template: body,
      tone: draft.tone,
      is_enabled: draft.is_enabled,
      is_default: draft.is_default,
    }

    const result = selectedId === 'new'
      ? await client
          .from('message_templates')
          .insert({
            workspace_id: workspaceId,
            template_key: draft.template_key,
            channel: 'email',
            ...editablePayload,
          })
          .select('*')
          .single()
      : await client
          .from('message_templates')
          .update(editablePayload)
          .eq('workspace_id', workspaceId)
          .eq('id', draft.id)
          .select('*')
          .single()

    setSaving(false)
    if (result.error) {
      setError(result.error.message)
      return
    }

    const saved = result.data as MessageTemplateRow
    setTemplates((current) => {
      const withoutConflictingDefaults = saved.is_default
        ? current.map((row) => row.purpose === saved.purpose && row.id !== saved.id ? { ...row, is_default: false } : row)
        : current
      const exists = withoutConflictingDefaults.some((row) => row.id === saved.id)
      return exists
        ? withoutConflictingDefaults.map((row) => row.id === saved.id ? saved : row)
        : [...withoutConflictingDefaults, saved]
    })
    setSelectedId(saved.id)
    setDraft({
      id: saved.id,
      template_key: saved.template_key,
      name: saved.name,
      purpose: saved.purpose,
      subject_template: saved.subject_template,
      body_template: saved.body_template,
      tone: saved.tone,
      is_enabled: saved.is_enabled,
      is_default: saved.is_default,
      version: saved.version,
    })
    setNotice(selectedId === 'new' ? 'Template created.' : `Template saved as revision ${saved.version}.`)
  }

  return (
    <section className="panel message-templates-panel">
      <div className="templates-heading">
        <div>
          <span className="mini-label">MESSAGE DESIGN</span>
          <h2>Branded email templates</h2>
          <p>Create reusable plain-text email templates that inherit the current workspace brand. This screen only validates and previews content—nothing is sent.</p>
        </div>
        <div className="templates-heading-actions">
          <span className={`branding-access-pill ${canManage ? 'editable' : 'readonly'}`}>{canManage ? 'Owner / admin controls' : 'Read only'}</span>
          <button className="button secondary" type="button" onClick={startNewTemplate} disabled={!canManage || loading || !schemaReady}>+ New template</button>
        </div>
      </div>

      {loading && <div className="branding-state">Loading message templates…</div>}
      {!loading && workspaceResolutionError && <div className="branding-state pending">{workspaceResolutionError}</div>}
      {!loading && !workspaceResolutionError && !schemaReady && (
        <div className="branding-state pending">The Branded Message Template source is ready, but the production `message_templates` migration has not been rolled out yet. No email behavior changes until that separate rollout gate is approved.</div>
      )}

      {!loading && !workspaceResolutionError && schemaReady && (
        <div className="templates-layout">
          <aside className="template-list">
            <div className="template-list-heading">
              <span>EMAIL TEMPLATES</span>
              <strong>{templates.length}</strong>
            </div>

            {templates.map((template) => (
              <button
                className={`template-list-item ${selectedId === template.id ? 'active' : ''}`}
                key={template.id}
                type="button"
                onClick={() => selectTemplate(template)}
              >
                <span className="template-list-copy">
                  <strong>{template.name}</strong>
                  <small>{purposeLabel(template.purpose)} · v{template.version}</small>
                </span>
                <span className="template-list-flags">
                  {template.is_default && <i>Default</i>}
                  <b className={template.is_enabled ? 'on' : 'off'}>{template.is_enabled ? 'On' : 'Off'}</b>
                </span>
              </button>
            ))}

            {selectedId === 'new' && (
              <div className="template-list-item active draft-item">
                <span className="template-list-copy"><strong>Unsaved template</strong><small>Custom · draft</small></span>
                <span className="template-list-flags"><b className="off">Draft</b></span>
              </div>
            )}

            {!templates.length && selectedId !== 'new' && <div className="template-empty">No templates yet.</div>}
          </aside>

          <div className="template-editor">
            <div className="template-editor-meta">
              <label className="branding-field">
                <span>Template name</span>
                <input value={draft.name} onChange={(event) => setField('name', event.target.value)} maxLength={120} disabled={!canManage} />
              </label>
              <label className="branding-field">
                <span>Purpose</span>
                <select value={draft.purpose} onChange={(event) => setField('purpose', event.target.value as MessageTemplateRow['purpose'])} disabled={!canManage}>
                  <option value="follow_up">Follow-up</option>
                  <option value="re_engagement">Re-engagement</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label className="branding-field">
                <span>Tone</span>
                <select value={draft.tone} onChange={(event) => setField('tone', event.target.value as MessageTemplateRow['tone'])} disabled={!canManage}>
                  <option value="professional">Professional</option>
                  <option value="friendly">Friendly</option>
                  <option value="warm">Warm</option>
                  <option value="concise">Concise</option>
                </select>
              </label>
            </div>

            <div className="template-toggle-row">
              <label><input type="checkbox" checked={draft.is_enabled} onChange={(event) => setField('is_enabled', event.target.checked)} disabled={!canManage} /><span>Enabled for future automation selection</span></label>
              <label><input type="checkbox" checked={draft.is_default} onChange={(event) => setField('is_default', event.target.checked)} disabled={!canManage} /><span>Default for {purposeLabel(draft.purpose).toLowerCase()}</span></label>
              <code>{draft.template_key}</code>
            </div>

            <label className="branding-field template-subject-field">
              <span>Email subject</span>
              <input
                value={draft.subject_template}
                onFocus={() => setActiveField('subject')}
                onChange={(event) => setField('subject_template', event.target.value)}
                maxLength={300}
                disabled={!canManage}
              />
            </label>

            <label className="branding-field template-body-field">
              <span>Email body · plain text only</span>
              <textarea
                value={draft.body_template}
                onFocus={() => setActiveField('body')}
                onChange={(event) => setField('body_template', event.target.value)}
                rows={10}
                maxLength={12000}
                disabled={!canManage}
              />
            </label>

            {(!subjectValidation.valid || !bodyValidation.valid) && (
              <div className="branding-feedback error">
                {[...subjectValidation.unknownVariables, ...bodyValidation.unknownVariables].length > 0
                  ? `Unknown variables: ${[...new Set([...subjectValidation.unknownVariables, ...bodyValidation.unknownVariables])].join(', ')}`
                  : 'One or more template tokens are malformed. Use the exact {{variable.name}} format.'}
              </div>
            )}

            <div className="template-variable-section">
              <div className="template-variable-heading">
                <div><strong>Allowed variables</strong><span>Click a variable to insert it into the last active subject/body field.</span></div>
                <small>{usedVariables.length} used</small>
              </div>
              <div className="template-variable-grid">
                {TEMPLATE_VARIABLES.map((variable) => (
                  <button type="button" key={variable.key} onClick={() => insertVariable(variable.key)} disabled={!canManage}>
                    <span>{variable.label}</span>
                    <code>{`{{${variable.key}}}`}</code>
                  </button>
                ))}
              </div>
            </div>

            {error && <div className="branding-feedback error">{error}</div>}
            {notice && <div className="branding-feedback success">{notice}</div>}

            <div className="branding-save-row template-save-row">
              <p>Saving stores template content and increments its revision. Provider delivery, unsubscribe handling and external sending stay outside this track.</p>
              <button className="button primary" type="button" onClick={() => void saveTemplate()} disabled={!canManage || saving || !subjectValidation.valid || !bodyValidation.valid}>
                {saving ? 'Saving…' : selectedId === 'new' ? 'Create template' : 'Save template'}
              </button>
            </div>
          </div>

          <aside className="template-preview-card" style={previewStyle}>
            <div className="template-preview-kicker">SAFE PREVIEW · SAMPLE LEAD</div>
            <div className="template-preview-brand">
              <div className="template-preview-logo">
                {logoUrl ? <img src={logoUrl} alt="" /> : <span>{(branding?.company_name || 'W').charAt(0).toUpperCase()}</span>}
              </div>
              <div>
                <strong>{branding?.company_name || 'Your company'}</strong>
                <span>{branding?.website_url || 'yourcompany.com'}</span>
              </div>
            </div>

            <div className="template-preview-meta">
              <span>From</span><strong>{branding?.sender_name || branding?.company_name || 'Your company'}</strong>
              <span>Reply-to</span><strong>{branding?.reply_to_email || 'Not configured'}</strong>
              <span>Tone</span><strong>{draft.tone}</strong>
            </div>

            <div className="template-preview-message">
              <div className="template-preview-subject"><span>Subject</span><strong>{previewSubject || 'No subject'}</strong></div>
              <div className="template-preview-body">{previewBody || 'No message body'}</div>
            </div>

            <div className="template-preview-guard">
              <strong>Preview only</strong>
              <p>Variables are rendered as plain text. User-authored HTML is not executed, and this component has no send action.</p>
            </div>
          </aside>
        </div>
      )}
    </section>
  )
}
