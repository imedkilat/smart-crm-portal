import { createClient } from 'npm:@supabase/supabase-js@2'

const N8N_URL = 'https://tolakautomations.app.n8n.cloud/webhook/799b1d66-0a5f-44b0-8f43-600ea4775979'
const PROD_ORIGIN = 'https://smart-crm-portal.vercel.app'
const LOCAL_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])
const MAX_JSON_BYTES = 64 * 1024
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const RATE_LIMIT = 20
const RATE_WINDOW_SECONDS = 60

function isAllowedOrigin(req: Request) {
  const origin = req.headers.get('origin')
  return !origin || origin === PROD_ORIGIN || LOCAL_ORIGINS.has(origin)
}

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || PROD_ORIGIN
  const allowedOrigin = origin === PROD_ORIGIN || LOCAL_ORIGINS.has(origin) ? origin : PROD_ORIGIN
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-idempotency-key, x-workspace-id',
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

function validIdempotencyKey(value: string | null) {
  if (!value) return null
  const key = value.trim()
  return /^[A-Za-z0-9:_-]{8,128}$/.test(key) ? key : null
}

async function resolveWorkspace(admin: ReturnType<typeof createClient>, userId: string, requestedWorkspaceId: string | null) {
  const { data: memberships, error } = await admin
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', userId)

  if (error) return { error: 'Workspace authorization is unavailable' as const }
  if (!memberships?.length) return { error: 'No CRM workspace membership found' as const }

  const selected = requestedWorkspaceId
    ? memberships.find((membership) => membership.workspace_id === requestedWorkspaceId)
    : memberships.length === 1 ? memberships[0] : null

  if (!selected) {
    return { error: requestedWorkspaceId ? 'Workspace access denied' as const : 'Workspace context required' as const }
  }

  const { data: workspace, error: workspaceError } = await admin
    .from('workspaces')
    .select('id, public_id, slug, name')
    .eq('id', selected.workspace_id)
    .single()

  if (workspaceError || !workspace) return { error: 'Workspace could not be resolved' as const }
  return { workspace, role: selected.role as string }
}

async function reserveIdempotencyKey(admin: ReturnType<typeof createClient>, key: string, userId: string) {
  const now = new Date()
  const nowIso = now.toISOString()
  await admin.from('automation_idempotency_keys').delete().eq('idempotency_key', key).lt('expires_at', nowIso)

  const { error } = await admin.from('automation_idempotency_keys').insert({
    idempotency_key: key,
    scope: 'crm-lead-intake',
    user_id: userId,
    expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  })

  if (!error) return 'reserved' as const
  if (error.code === '23505') return 'duplicate' as const
  console.error('Idempotency reservation failed', { code: error.code })
  return 'error' as const
}

async function consumeRateLimit(admin: ReturnType<typeof createClient>, workspaceId: string, userId: string) {
  const { data, error } = await admin.rpc('consume_automation_rate_limit', {
    p_key: `crm-lead-intake:${workspaceId}:${userId}`,
    p_limit: RATE_LIMIT,
    p_window_seconds: RATE_WINDOW_SECONDS,
  })
  if (error || !data?.length) {
    console.error('Rate limiter failed', { code: error?.code })
    return null
  }
  return data[0] as { allowed: boolean; remaining: number; retry_after_seconds: number }
}

function validateManualPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'Request body must be a JSON object'
  const body = payload as Record<string, unknown>
  if (body.submission_type !== 'manual_add') return 'Invalid submission_type'
  if (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.length > 160) return 'Invalid lead name'
  if (typeof body.email !== 'string' || body.email.length > 320 || !body.email.includes('@')) return 'Invalid lead email'
  if (typeof body.message !== 'string' || body.message.trim().length < 1 || body.message.length > 10000) return 'Invalid lead message'
  if (body.budget != null && typeof body.budget !== 'string' && typeof body.budget !== 'number') return 'Invalid budget'
  if (body.currency_code != null && body.currency_code !== 'USD') return 'Only USD is supported'
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
  const ingressToken = Deno.env.get('N8N_LEAD_INGRESS_TOKEN') || ''
  if (!supabaseUrl || !serviceRoleKey) return json(req, 500, { error: 'Server auth is not configured' })
  if (!ingressToken) return json(req, 500, { error: 'Lead automation ingress is not configured' })

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const token = authHeader.slice('Bearer '.length)
  const { data: { user }, error: userError } = await admin.auth.getUser(token)
  if (userError || !user) return json(req, 401, { error: 'Invalid or expired session' })

  const workspaceResult = await resolveWorkspace(admin, user.id, req.headers.get('x-workspace-id'))
  if ('error' in workspaceResult) return json(req, workspaceResult.error === 'Workspace access denied' ? 403 : 409, { error: workspaceResult.error })
  const { workspace } = workspaceResult

  const rate = await consumeRateLimit(admin, workspace.id, user.id)
  if (!rate) return json(req, 503, { error: 'Request protection is temporarily unavailable' })
  const rateHeaders = { 'RateLimit-Limit': String(RATE_LIMIT), 'RateLimit-Remaining': String(rate.remaining) }
  if (!rate.allowed) {
    return json(req, 429, { error: 'Too many lead intake requests. Try again shortly.' }, { ...rateHeaders, 'Retry-After': String(rate.retry_after_seconds) })
  }

  const contentType = req.headers.get('content-type') || 'application/octet-stream'
  const contentLength = Number(req.headers.get('content-length') || '0')
  const isJson = contentType.includes('application/json')
  const isMultipart = contentType.includes('multipart/form-data')
  const maxBytes = isJson ? MAX_JSON_BYTES : MAX_UPLOAD_BYTES
  if (contentLength > maxBytes) return json(req, 413, { error: 'Request payload is too large' }, rateHeaders)
  if (!isJson && !isMultipart) return json(req, 415, { error: 'Unsupported content type' }, rateHeaders)

  const idempotencyKey = validIdempotencyKey(req.headers.get('x-idempotency-key'))
  if (req.headers.get('x-idempotency-key') && !idempotencyKey) return json(req, 400, { error: 'Invalid idempotency key' }, rateHeaders)
  if (idempotencyKey) {
    const reservation = await reserveIdempotencyKey(admin, idempotencyKey, user.id)
    if (reservation === 'error') return json(req, 503, { error: 'Duplicate-request protection is temporarily unavailable' }, rateHeaders)
    if (reservation === 'duplicate') return json(req, 202, { accepted: true, duplicate: true }, rateHeaders)
  }

  try {
    let upstream: Response

    if (isJson) {
      const raw = await req.text()
      if (new TextEncoder().encode(raw).byteLength > MAX_JSON_BYTES) return json(req, 413, { error: 'Request payload is too large' }, rateHeaders)
      let payload: Record<string, unknown>
      try { payload = JSON.parse(raw) } catch { return json(req, 400, { error: 'Invalid JSON payload' }, rateHeaders) }
      const validationError = validateManualPayload(payload)
      if (validationError) return json(req, 422, { error: validationError }, rateHeaders)

      const trustedPayload = {
        ...payload,
        workspace_id: workspace.id,
        workspace_public_id: workspace.public_id,
        workspace_slug: workspace.slug,
        currency_code: 'USD',
      }

      upstream = await fetch(N8N_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-smart-crm-ingress-token': ingressToken },
        body: JSON.stringify(trustedPayload),
      })
    } else {
      const form = await req.formData()
      let totalFileBytes = 0
      for (const value of form.values()) if (value instanceof File) totalFileBytes += value.size
      if (totalFileBytes > MAX_UPLOAD_BYTES) return json(req, 413, { error: 'Uploaded file is too large' }, rateHeaders)
      form.set('workspace_id', workspace.id)
      form.set('workspace_public_id', workspace.public_id)
      form.set('workspace_slug', workspace.slug)
      form.set('currency_code', 'USD')

      upstream = await fetch(N8N_URL, {
        method: 'POST',
        headers: { 'x-smart-crm-ingress-token': ingressToken },
        body: form,
      })
    }

    if (!upstream.ok && idempotencyKey) await admin.from('automation_idempotency_keys').delete().eq('idempotency_key', idempotencyKey)
    const responseBody = await upstream.arrayBuffer()
    const responseType = upstream.headers.get('content-type') || 'application/json'
    return new Response(responseBody, { status: upstream.status, headers: { ...corsHeaders(req), 'Content-Type': responseType, ...rateHeaders } })
  } catch (error) {
    if (idempotencyKey) await admin.from('automation_idempotency_keys').delete().eq('idempotency_key', idempotencyKey)
    console.error('Lead intake proxy failed', error)
    return json(req, 502, { error: 'Lead intake automation is temporarily unavailable' }, rateHeaders)
  }
})
