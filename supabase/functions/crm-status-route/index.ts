import { createClient } from 'npm:@supabase/supabase-js@2'

const N8N_URL = 'https://tolakautomations.app.n8n.cloud/webhook/smart-crm-status-route'
const PROD_ORIGIN = 'https://smart-crm-portal.vercel.app'
const LOCAL_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])
const MAX_BODY_BYTES = 64 * 1024
const RATE_LIMIT = 30
const RATE_WINDOW_SECONDS = 60
const ALLOWED_STATUSES = new Set(['Hot', 'Warm', 'Cold'])

type EntitlementGate = {
  allowed: boolean
  reason: string
  plan_code: string | null
  subscription_status: string | null
  entitlement_enabled: boolean
  limit_value: number | null
  used_value: number
  remaining_value: number | null
  period_start: string
  period_end: string
}

function isAllowedOrigin(req: Request) {
  const origin = req.headers.get('origin')
  return !origin || origin === PROD_ORIGIN || LOCAL_ORIGINS.has(origin)
}

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || PROD_ORIGIN
  const allowedOrigin = origin === PROD_ORIGIN || LOCAL_ORIGINS.has(origin) ? origin : PROD_ORIGIN
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-idempotency-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function json(req: Request, status: number, payload: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json', ...extraHeaders },
  })
}

function validKey(value: string | null) {
  if (!value) return null
  const key = value.trim()
  return /^[A-Za-z0-9:_-]{8,128}$/.test(key) ? key : null
}

async function consumeRateLimit(admin: ReturnType<typeof createClient>, workspaceId: string, userId: string) {
  const { data, error } = await admin.rpc('consume_automation_rate_limit', {
    p_key: `crm-status-route:${workspaceId}:${userId}`,
    p_limit: RATE_LIMIT,
    p_window_seconds: RATE_WINDOW_SECONDS,
  })
  if (error || !data?.length) {
    console.error('Rate limiter failed', { code: error?.code })
    return null
  }
  return data[0] as { allowed: boolean; remaining: number; retry_after_seconds: number }
}

async function checkWorkspaceEntitlement(
  admin: ReturnType<typeof createClient>,
  workspaceId: string,
  entitlementKey: string,
) {
  const { data, error } = await admin.rpc('check_workspace_entitlement', {
    p_workspace_id: workspaceId,
    p_entitlement_key: entitlementKey,
  })

  if (error || !data?.length) {
    console.error('Routing entitlement check failed', { code: error?.code })
    return null
  }
  return data[0] as EntitlementGate
}

async function reserveIdempotencyKey(admin: ReturnType<typeof createClient>, key: string, userId: string) {
  const now = new Date()
  const nowIso = now.toISOString()
  await admin.from('automation_idempotency_keys').delete().eq('idempotency_key', key).lt('expires_at', nowIso)

  const { error } = await admin.from('automation_idempotency_keys').insert({
    idempotency_key: key,
    scope: 'crm-status-route',
    user_id: userId,
    expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  })

  if (!error) return 'reserved' as const
  if (error.code === '23505') return 'duplicate' as const
  console.error('Idempotency reservation failed', { code: error.code })
  return 'error' as const
}

function validatePayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'Request body must be a JSON object'
  const body = payload as Record<string, unknown>
  if (body.event !== 'routing_status_changed') return 'Invalid routing event'
  if (typeof body.event_id !== 'string' || !validKey(body.event_id)) return 'Invalid event_id'
  if (!Number.isInteger(Number(body.lead_id)) || Number(body.lead_id) < 1) return 'Invalid lead_id'
  if (typeof body.routing_status !== 'string' || !ALLOWED_STATUSES.has(body.routing_status)) return 'Invalid routing_status'
  if (body.previous_status != null && typeof body.previous_status !== 'string') return 'Invalid previous_status'
  if (body.lead != null && typeof body.lead !== 'object') return 'Invalid lead payload'
  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'Method not allowed' })
  if (!isAllowedOrigin(req)) return json(req, 403, { error: 'Origin not allowed' })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json(req, 401, { error: 'Authentication required' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const ingressToken = Deno.env.get('N8N_STATUS_INGRESS_TOKEN') || ''
  if (!supabaseUrl || !serviceRoleKey) return json(req, 500, { error: 'Server auth is not configured' })
  if (!ingressToken) return json(req, 500, { error: 'Status automation ingress is not configured' })

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const token = authHeader.slice('Bearer '.length)
  const { data: { user }, error: userError } = await admin.auth.getUser(token)
  if (userError || !user) return json(req, 401, { error: 'Invalid or expired session' })

  const contentLength = Number(req.headers.get('content-length') || '0')
  if (contentLength > MAX_BODY_BYTES) return json(req, 413, { error: 'Request payload is too large' })

  let payload: Record<string, unknown>
  try {
    const raw = await req.text()
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json(req, 413, { error: 'Request payload is too large' })
    payload = JSON.parse(raw)
  } catch {
    return json(req, 400, { error: 'Invalid JSON payload' })
  }

  const validationError = validatePayload(payload)
  if (validationError) return json(req, 422, { error: validationError })

  const leadId = Number(payload.lead_id)
  const { data: leadRecord, error: leadError } = await admin
    .from('leads')
    .select('id, public_id, name, email, summary, category, intent, source, workspace_id')
    .eq('id', leadId)
    .single()
  if (leadError || !leadRecord?.workspace_id) return json(req, 404, { error: 'Lead not found' })

  const { data: membership, error: membershipError } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', leadRecord.workspace_id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (membershipError) return json(req, 503, { error: 'Workspace authorization is temporarily unavailable' })
  if (!membership) return json(req, 403, { error: 'Workspace access denied' })

  const entitlement = await checkWorkspaceEntitlement(admin, leadRecord.workspace_id, 'follow_up_automation')
  if (!entitlement) return json(req, 503, { error: 'Automation billing entitlement is temporarily unavailable' })
  if (!entitlement.allowed) {
    return json(req, 403, {
      error: 'Workspace plan does not include follow-up automation',
      billing_reason: entitlement.reason,
      plan_code: entitlement.plan_code,
      subscription_status: entitlement.subscription_status,
    })
  }

  const rate = await consumeRateLimit(admin, leadRecord.workspace_id, user.id)
  if (!rate) return json(req, 503, { error: 'Request protection is temporarily unavailable' })
  const rateHeaders = { 'RateLimit-Limit': String(RATE_LIMIT), 'RateLimit-Remaining': String(rate.remaining) }
  if (!rate.allowed) {
    return json(req, 429, { error: 'Too many routing requests. Try again shortly.' }, { ...rateHeaders, 'Retry-After': String(rate.retry_after_seconds) })
  }

  const idempotencyKey = validKey(String(payload.event_id))!
  const reservation = await reserveIdempotencyKey(admin, idempotencyKey, user.id)
  if (reservation === 'error') return json(req, 503, { error: 'Duplicate-request protection is temporarily unavailable' }, rateHeaders)
  if (reservation === 'duplicate') return json(req, 202, { accepted: true, duplicate: true }, rateHeaders)

  // Never trust the browser-supplied lead object for outbound automation.
  // Rehydrate the authoritative lead record from the caller's workspace.
  const trustedPayload = {
    ...payload,
    lead_id: leadRecord.id,
    lead_public_id: leadRecord.public_id,
    lead: {
      id: leadRecord.id,
      public_id: leadRecord.public_id,
      name: leadRecord.name,
      email: leadRecord.email,
      summary: leadRecord.summary,
      category: leadRecord.category,
      intent: leadRecord.intent,
      source: leadRecord.source,
    },
    workspace_id: leadRecord.workspace_id,
    user_id: user.id,
  }

  try {
    const upstream = await fetch(N8N_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-smart-crm-ingress-token': ingressToken },
      body: JSON.stringify(trustedPayload),
    })

    if (!upstream.ok) await admin.from('automation_idempotency_keys').delete().eq('idempotency_key', idempotencyKey)
    const responseBody = await upstream.arrayBuffer()
    const responseType = upstream.headers.get('content-type') || 'application/json'
    return new Response(responseBody, { status: upstream.status, headers: { ...corsHeaders(req), 'Content-Type': responseType, ...rateHeaders } })
  } catch (error) {
    await admin.from('automation_idempotency_keys').delete().eq('idempotency_key', idempotencyKey)
    console.error('Status routing proxy failed', error)
    return json(req, 502, { error: 'Routing automation is temporarily unavailable' }, rateHeaders)
  }
})