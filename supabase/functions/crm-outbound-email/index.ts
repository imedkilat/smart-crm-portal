import { createClient } from 'npm:@supabase/supabase-js@2'

const MAX_BODY_BYTES = 16 * 1024
const ENTITLED_PLAN_CODES = new Set(['starter', 'pro', 'white_label'])
const ALLOWED_TEMPLATE_VARIABLES = new Set([
  'lead.first_name',
  'lead.name',
  'lead.company',
  'lead.email',
  'lead.routing_status',
  'workspace.company_name',
  'workspace.website_url',
  'workspace.sender_name',
  'workspace.reply_to_email',
  'workspace.email_signature',
])
const VARIABLE_PATTERN = /{{\s*([a-zA-Z0-9_.]+)\s*}}/g

type AdminClient = ReturnType<typeof createClient>

type DispatchPayload = {
  workspace_id?: unknown
  lead_public_id?: unknown
  template_key?: unknown
  idempotency_key?: unknown
  scheduled_for?: unknown
}

type TemplateContext = {
  lead: Record<string, string>
  workspace: Record<string, string>
}

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function safeString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) return ''
  return trimmed
}

function validWorkspaceId(value: unknown) {
  const id = safeString(value, 64)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : ''
}

function validLeadPublicId(value: unknown) {
  const id = safeString(value, 40)
  return /^ld_[a-zA-Z0-9]{8,32}$/.test(id) ? id : ''
}

function validTemplateKey(value: unknown) {
  const key = safeString(value, 120)
  return /^[a-z0-9][a-z0-9_-]{1,119}$/.test(key) ? key : ''
}

function validIdempotencyKey(value: unknown) {
  const key = safeString(value, 180)
  return /^[A-Za-z0-9:_-]{8,180}$/.test(key) ? key : ''
}

function firstName(name: string | null | undefined) {
  return (name || '').trim().split(/\s+/)[0] || 'there'
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderTemplate(template: string, context: TemplateContext) {
  const variables = [...template.matchAll(VARIABLE_PATTERN)].map((match) => match[1])
  const unknown = [...new Set(variables.filter((key) => !ALLOWED_TEMPLATE_VARIABLES.has(key)))]
  const stripped = template.replace(VARIABLE_PATTERN, '')
  if (unknown.length || stripped.includes('{{') || stripped.includes('}}')) {
    throw new Error(unknown.length ? `Unknown template variable: ${unknown.join(', ')}` : 'Malformed template variable')
  }

  return template.replace(VARIABLE_PATTERN, (_match, rawKey: string) => {
    const [scope, field] = rawKey.split('.')
    return String(context[scope as keyof TemplateContext]?.[field] || '')
  })
}

function dayStartUtc() {
  const now = new Date()
  now.setUTCHours(0, 0, 0, 0)
  return now.toISOString()
}

async function resolveEntitlement(admin: AdminClient, workspaceId: string) {
  const { data: subscription, error: subscriptionError } = await admin
    .from('subscriptions')
    .select('plan_id, status, created_at')
    .eq('workspace_id', workspaceId)
    .in('status', ['trialing', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (subscriptionError || !subscription) return { entitled: false, planCode: null, subscriptionStatus: null }

  const { data: plan, error: planError } = await admin
    .from('plans')
    .select('code, is_active')
    .eq('id', subscription.plan_id)
    .maybeSingle()

  if (planError || !plan) return { entitled: false, planCode: null, subscriptionStatus: subscription.status }
  return {
    entitled: plan.is_active === true && ENTITLED_PLAN_CODES.has(plan.code),
    planCode: plan.code as string,
    subscriptionStatus: subscription.status as string,
  }
}

async function loadExistingDelivery(admin: AdminClient, workspaceId: string, idempotencyKey: string) {
  const { data } = await admin
    .from('outbound_email_deliveries')
    .select('public_id, status, mode, provider, provider_message_id, attempt_count, created_at')
    .eq('workspace_id', workspaceId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  return data || null
}

async function simulateDelivery(
  admin: AdminClient,
  delivery: { id: string; workspace_id: string; attempt_count: number },
  provider: string | null,
) {
  const attemptedAt = new Date().toISOString()
  const attemptNumber = delivery.attempt_count + 1

  const { error: attemptError } = await admin.from('outbound_email_attempts').insert({
    workspace_id: delivery.workspace_id,
    delivery_id: delivery.id,
    attempt_number: attemptNumber,
    mode: 'simulate',
    provider,
    status: 'simulated',
    response_metadata: { network_call_performed: false },
    attempted_at: attemptedAt,
  })
  if (attemptError) throw new Error(`Could not record simulation attempt: ${attemptError.code}`)

  const { error: updateError } = await admin
    .from('outbound_email_deliveries')
    .update({
      status: 'simulated',
      attempt_count: attemptNumber,
      last_attempt_at: attemptedAt,
      last_error_code: null,
      last_error_message: null,
    })
    .eq('id', delivery.id)
    .eq('workspace_id', delivery.workspace_id)
  if (updateError) throw new Error(`Could not finalize simulation: ${updateError.code}`)

  return { attemptNumber, attemptedAt }
}

async function sendWithResend(params: {
  apiKey: string
  fromAddress: string
  senderName: string
  replyTo: string | null
  to: string
  subject: string
  bodyText: string
}) {
  const from = params.senderName ? `${params.senderName} <${params.fromAddress}>` : params.fromAddress
  const upstream = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: params.subject,
      text: params.bodyText,
      html: escapeHtml(params.bodyText).replace(/\r?\n/g, '<br />'),
      ...(params.replyTo ? { reply_to: params.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(20000),
  })

  const raw = await upstream.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = raw ? JSON.parse(raw) : {}
  } catch {
    parsed = { raw: raw.slice(0, 1000) }
  }

  if (!upstream.ok) {
    const message = typeof parsed.message === 'string' ? parsed.message : `Resend returned HTTP ${upstream.status}`
    return { ok: false as const, httpStatus: upstream.status, errorMessage: message, metadata: parsed }
  }

  const providerMessageId = typeof parsed.id === 'string' ? parsed.id : null
  if (!providerMessageId) {
    return { ok: false as const, httpStatus: upstream.status, errorMessage: 'Provider response did not include a message id', metadata: parsed }
  }

  return { ok: true as const, httpStatus: upstream.status, providerMessageId, metadata: parsed }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const ingressToken = Deno.env.get('OUTBOUND_EMAIL_INGRESS_TOKEN') || ''
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: 'Server database access is not configured' })
  if (!ingressToken) return json(503, { error: 'Outbound email dispatch is not configured' })

  const suppliedToken = req.headers.get('x-smart-crm-outbound-token') || ''
  if (!suppliedToken || suppliedToken !== ingressToken) return json(403, { error: 'Outbound dispatch denied' })

  const contentLength = Number(req.headers.get('content-length') || '0')
  if (contentLength > MAX_BODY_BYTES) return json(413, { error: 'Request payload is too large' })

  let payload: DispatchPayload
  try {
    const raw = await req.text()
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json(413, { error: 'Request payload is too large' })
    payload = JSON.parse(raw)
  } catch {
    return json(400, { error: 'Invalid JSON payload' })
  }

  const workspaceId = validWorkspaceId(payload.workspace_id)
  const leadPublicId = validLeadPublicId(payload.lead_public_id)
  const templateKey = validTemplateKey(payload.template_key)
  const idempotencyKey = validIdempotencyKey(payload.idempotency_key)
  if (!workspaceId || !leadPublicId || !templateKey || !idempotencyKey) {
    return json(422, { error: 'workspace_id, lead_public_id, template_key and idempotency_key are required and must be valid' })
  }

  const scheduledForInput = safeString(payload.scheduled_for, 64)
  const scheduledForDate = scheduledForInput ? new Date(scheduledForInput) : new Date()
  if (!Number.isFinite(scheduledForDate.getTime())) return json(422, { error: 'scheduled_for must be a valid timestamp' })

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const existing = await loadExistingDelivery(admin, workspaceId, idempotencyKey)
  if (existing) {
    return json(200, { ok: true, duplicate: true, delivery: existing, message: 'Logical outbound email already exists; no second send was attempted.' })
  }

  const { data: settings, error: settingsError } = await admin
    .from('workspace_outbound_email_settings')
    .select('workspace_id, enabled, mode, provider, max_emails_per_run, max_emails_per_day, paused_until')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (settingsError || !settings) return json(409, { error: 'Outbound email settings are unavailable for this workspace' })
  if (settings.enabled !== true || settings.mode === 'disabled') return json(409, { error: 'Outbound email is disabled for this workspace' })
  if (settings.paused_until && new Date(settings.paused_until).getTime() > Date.now()) return json(409, { error: 'Outbound email is paused for this workspace' })

  const entitlement = await resolveEntitlement(admin, workspaceId)
  if (!entitlement.entitled) {
    return json(403, {
      error: 'Workspace is not entitled to outbound follow-up email',
      plan_code: entitlement.planCode,
      subscription_status: entitlement.subscriptionStatus,
    })
  }

  const { count: todayCount, error: countError } = await admin
    .from('outbound_email_deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .gte('created_at', dayStartUtc())
    .in('status', ['simulated', 'sending', 'sent', 'delivered', 'bounced'])
  if (countError) return json(503, { error: 'Outbound daily-cap check is unavailable' })
  if ((todayCount || 0) >= settings.max_emails_per_day) {
    return json(429, { error: 'Workspace daily outbound email cap has been reached', max_emails_per_day: settings.max_emails_per_day })
  }

  const [{ data: lead, error: leadError }, { data: template, error: templateError }, { data: branding, error: brandingError }] = await Promise.all([
    admin
      .from('leads')
      .select('id, public_id, workspace_id, name, email, routing_status, category')
      .eq('workspace_id', workspaceId)
      .eq('public_id', leadPublicId)
      .maybeSingle(),
    admin
      .from('message_templates')
      .select('template_key, channel, purpose, subject_template, body_template, is_enabled, version')
      .eq('workspace_id', workspaceId)
      .eq('template_key', templateKey)
      .maybeSingle(),
    admin
      .from('workspace_branding')
      .select('company_name, website_url, sender_name, reply_to_email, email_signature')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
  ])

  if (leadError || !lead) return json(404, { error: 'Lead not found in this workspace' })
  if (!lead.email?.trim()) return json(422, { error: 'Lead does not have an email address' })
  if (templateError || !template || template.channel !== 'email' || template.is_enabled !== true) {
    return json(404, { error: 'Enabled email template not found in this workspace' })
  }
  if (brandingError || !branding) return json(409, { error: 'Workspace branding is unavailable' })

  const context: TemplateContext = {
    lead: {
      first_name: firstName(lead.name),
      name: lead.name || '',
      company: '',
      email: lead.email,
      routing_status: lead.routing_status || lead.category || '',
    },
    workspace: {
      company_name: branding.company_name || '',
      website_url: branding.website_url || '',
      sender_name: branding.sender_name || branding.company_name || '',
      reply_to_email: branding.reply_to_email || '',
      email_signature: branding.email_signature || '',
    },
  }

  let renderedSubject: string
  let renderedBody: string
  try {
    renderedSubject = renderTemplate(template.subject_template, context).trim()
    renderedBody = renderTemplate(template.body_template, context).trim()
  } catch (error) {
    return json(422, { error: error instanceof Error ? error.message : 'Template rendering failed' })
  }
  if (!renderedSubject || !renderedBody) return json(422, { error: 'Rendered email subject/body cannot be empty' })

  const provider = settings.mode === 'live' ? settings.provider : (settings.provider || 'simulation')
  const { data: delivery, error: deliveryError } = await admin
    .from('outbound_email_deliveries')
    .insert({
      workspace_id: workspaceId,
      lead_id: lead.id,
      template_key: template.template_key,
      idempotency_key: idempotencyKey,
      mode: settings.mode,
      provider,
      to_email: lead.email.trim(),
      rendered_subject: renderedSubject,
      rendered_body: renderedBody,
      status: 'prepared',
      scheduled_for: scheduledForDate.toISOString(),
      metadata: {
        lead_public_id: lead.public_id,
        template_version: template.version,
        template_purpose: template.purpose,
        plan_code: entitlement.planCode,
        network_call_performed: false,
      },
    })
    .select('id, public_id, workspace_id, mode, provider, status, attempt_count, to_email, rendered_subject')
    .single()

  if (deliveryError || !delivery) {
    if (deliveryError?.code === '23505') {
      const duplicate = await loadExistingDelivery(admin, workspaceId, idempotencyKey)
      return json(200, { ok: true, duplicate: true, delivery: duplicate, message: 'Logical outbound email already exists; no second send was attempted.' })
    }
    return json(500, { error: 'Could not reserve outbound email delivery', code: deliveryError?.code })
  }

  if (settings.mode === 'simulate') {
    try {
      const simulation = await simulateDelivery(admin, delivery, provider)
      return json(200, {
        ok: true,
        simulated: true,
        network_call_performed: false,
        delivery_public_id: delivery.public_id,
        attempt_number: simulation.attemptNumber,
        to_email: delivery.to_email,
        subject: delivery.rendered_subject,
        message: 'Outbound email rendered and logged in simulation mode. No provider call was performed.',
      })
    } catch (error) {
      return json(500, { error: error instanceof Error ? error.message : 'Simulation failed' })
    }
  }

  if (settings.mode !== 'live') return json(409, { error: 'Unsupported outbound email mode' })
  if (settings.provider !== 'resend') {
    return json(503, { error: 'Configured outbound provider adapter is not implemented', provider: settings.provider })
  }

  const resendApiKey = Deno.env.get('RESEND_API_KEY') || ''
  const fromAddress = Deno.env.get('OUTBOUND_EMAIL_FROM') || ''
  if (!resendApiKey || !fromAddress) {
    await admin.from('outbound_email_deliveries').update({ status: 'failed', last_error_code: 'provider_not_configured', last_error_message: 'Live provider secrets/from address are not configured.' }).eq('id', delivery.id)
    return json(503, { error: 'Live outbound email provider is not configured' })
  }

  const attemptNumber = delivery.attempt_count + 1
  const attemptedAt = new Date().toISOString()
  await admin.from('outbound_email_deliveries').update({ status: 'sending', attempt_count: attemptNumber, last_attempt_at: attemptedAt }).eq('id', delivery.id)

  try {
    const providerResult = await sendWithResend({
      apiKey: resendApiKey,
      fromAddress,
      senderName: branding.sender_name || branding.company_name || 'Smart CRM',
      replyTo: branding.reply_to_email || null,
      to: lead.email.trim(),
      subject: renderedSubject,
      bodyText: renderedBody,
    })

    if (!providerResult.ok) {
      await admin.from('outbound_email_attempts').insert({
        workspace_id: workspaceId,
        delivery_id: delivery.id,
        attempt_number: attemptNumber,
        mode: 'live',
        provider: settings.provider,
        status: 'failed',
        http_status: providerResult.httpStatus,
        error_code: 'provider_rejected',
        error_message: providerResult.errorMessage,
        response_metadata: providerResult.metadata,
        attempted_at: attemptedAt,
      })
      await admin.from('outbound_email_deliveries').update({
        status: 'failed',
        last_error_code: 'provider_rejected',
        last_error_message: providerResult.errorMessage,
      }).eq('id', delivery.id)
      return json(502, { error: 'Outbound provider rejected the email', delivery_public_id: delivery.public_id })
    }

    const sentAt = new Date().toISOString()
    await admin.from('outbound_email_attempts').insert({
      workspace_id: workspaceId,
      delivery_id: delivery.id,
      attempt_number: attemptNumber,
      mode: 'live',
      provider: settings.provider,
      status: 'sent',
      provider_message_id: providerResult.providerMessageId,
      http_status: providerResult.httpStatus,
      response_metadata: providerResult.metadata,
      attempted_at: attemptedAt,
    })
    await admin.from('outbound_email_deliveries').update({
      status: 'sent',
      sent_at: sentAt,
      provider_message_id: providerResult.providerMessageId,
      last_error_code: null,
      last_error_message: null,
      metadata: {
        lead_public_id: lead.public_id,
        template_version: template.version,
        template_purpose: template.purpose,
        plan_code: entitlement.planCode,
        network_call_performed: true,
      },
    }).eq('id', delivery.id)

    await admin.from('lead_activities').insert({
      workspace_id: workspaceId,
      lead_id: lead.id,
      activity_type: 'outbound_email_sent',
      title: 'Follow-up email sent',
      metadata: {
        delivery_public_id: delivery.public_id,
        template_key: template.template_key,
        provider: settings.provider,
        provider_message_id: providerResult.providerMessageId,
      },
    })

    return json(200, {
      ok: true,
      simulated: false,
      network_call_performed: true,
      delivery_public_id: delivery.public_id,
      provider_message_id: providerResult.providerMessageId,
      message: 'Outbound follow-up email sent.',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provider request failed'
    await admin.from('outbound_email_attempts').insert({
      workspace_id: workspaceId,
      delivery_id: delivery.id,
      attempt_number: attemptNumber,
      mode: 'live',
      provider: settings.provider,
      status: 'failed',
      error_code: 'provider_request_failed',
      error_message: message,
      attempted_at: attemptedAt,
    })
    await admin.from('outbound_email_deliveries').update({
      status: 'failed',
      last_error_code: 'provider_request_failed',
      last_error_message: message,
    }).eq('id', delivery.id)
    return json(502, { error: 'Outbound provider request failed', delivery_public_id: delivery.public_id })
  }
})
