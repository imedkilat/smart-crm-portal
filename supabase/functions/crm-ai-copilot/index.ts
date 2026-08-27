import { createClient } from 'npm:@supabase/supabase-js@2'

const N8N_URL = 'https://tolakautomations.app.n8n.cloud/webhook/smart-crm-ai-copilot'
const PROD_ORIGIN = 'https://smart-crm-portal.vercel.app'
const LOCAL_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])
const MAX_BODY_BYTES = 48 * 1024
const RATE_LIMIT = 15
const RATE_WINDOW_SECONDS = 60
const ALLOWED_SCOPES = new Set(['workspace', 'lead', 'contact', 'company', 'deal'])

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

function validKey(value: string | null) {
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

  if (!selected) return { error: requestedWorkspaceId ? 'Workspace access denied' as const : 'Workspace context required' as const }

  const { data: workspace, error: workspaceError } = await admin
    .from('workspaces')
    .select('id, public_id, slug, name')
    .eq('id', selected.workspace_id)
    .single()

  if (workspaceError || !workspace) return { error: 'Workspace could not be resolved' as const }
  return { workspace, role: selected.role as string }
}

async function validateScopedRecord(admin: ReturnType<typeof createClient>, workspaceId: string, scopeType: string, scopeKey: string | null) {
  if (scopeType === 'workspace') return true
  if (!scopeKey) return false

  const tableByScope: Record<string, { table: string; column: string }> = {
    lead: { table: 'leads', column: 'public_id' },
    contact: { table: 'contacts', column: 'public_id' },
    company: { table: 'companies', column: 'public_id' },
    deal: { table: 'deals', column: 'public_id' },
  }
  const target = tableByScope[scopeType]
  if (!target) return false

  const { data, error } = await admin
    .from(target.table)
    .select('workspace_id')
    .eq(target.column, scopeKey)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  return !error && Boolean(data)
}

async function consumeRateLimit(admin: ReturnType<typeof createClient>, workspaceId: string, userId: string) {
  const { data, error } = await admin.rpc('consume_automation_rate_limit', {
    p_key: `crm-ai-copilot:${workspaceId}:${userId}`,
    p_limit: RATE_LIMIT,
    p_window_seconds: RATE_WINDOW_SECONDS,
  })
  if (error || !data?.length) {
    console.error('AI rate limiter failed', { code: error?.code })
    return null
  }
  return data[0] as { allowed: boolean; remaining: number; retry_after_seconds: number }
}

async function reserveIdempotencyKey(admin: ReturnType<typeof createClient>, key: string, userId: string) {
  const now = new Date()
  const nowIso = now.toISOString()
  await admin.from('automation_idempotency_keys').delete().eq('idempotency_key', key).lt('expires_at', nowIso)
  const { error } = await admin.from('automation_idempotency_keys').insert({
    idempotency_key: key,
    scope: 'crm-ai-copilot',
    user_id: userId,
    expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
  })
  if (!error) return 'reserved' as const
  if (error.code === '23505') return 'duplicate' as const
  console.error('AI idempotency reservation failed', { code: error.code })
  return 'error' as const
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'Method not allowed' })
  if (!isAllowedOrigin(req)) return json(req, 403, { error: 'Origin not allowed' })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json(req, 401, { error: 'Authentication required' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  // Temporary shared internal ingress credential. Before unrelated paying tenants,
  // rotate this to a dedicated N8N_AI_INGRESS_TOKEN without changing the client API.
  const ingressToken = Deno.env.get('N8N_LEAD_INGRESS_TOKEN') || ''
  if (!supabaseUrl || !serviceRoleKey) return json(req, 500, { error: 'Server auth is not configured' })
  if (!ingressToken) return json(req, 500, { error: 'AI automation ingress is not configured' })

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const token = authHeader.slice('Bearer '.length)
  const { data: { user }, error: userError } = await admin.auth.getUser(token)
  if (userError || !user) return json(req, 401, { error: 'Invalid or expired session' })

  const workspaceResult = await resolveWorkspace(admin, user.id, req.headers.get('x-workspace-id'))
  if ('error' in workspaceResult) return json(req, workspaceResult.error === 'Workspace access denied' ? 403 : 409, { error: workspaceResult.error })
  const { workspace } = workspaceResult

  const rate = await consumeRateLimit(admin, workspace.id, user.id)
  if (!rate) return json(req, 503, { error: 'AI request protection is temporarily unavailable' })
  const rateHeaders = { 'RateLimit-Limit': String(RATE_LIMIT), 'RateLimit-Remaining': String(rate.remaining) }
  if (!rate.allowed) {
    return json(req, 429, { error: 'Too many AI requests. Try again shortly.' }, { ...rateHeaders, 'Retry-After': String(rate.retry_after_seconds) })
  }

  const contentLength = Number(req.headers.get('content-length') || '0')
  if (contentLength > MAX_BODY_BYTES) return json(req, 413, { error: 'Request payload is too large' }, rateHeaders)

  let payload: Record<string, unknown>
  try {
    const raw = await req.text()
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json(req, 413, { error: 'Request payload is too large' }, rateHeaders)
    payload = JSON.parse(raw)
  } catch {
    return json(req, 400, { error: 'Invalid JSON payload' }, rateHeaders)
  }

  const question = typeof payload.question === 'string' ? payload.question.trim() : ''
  if (!question || question.length > 12000) return json(req, 422, { error: 'question must be 1-12000 characters' }, rateHeaders)

  const scopeType = ALLOWED_SCOPES.has(String(payload.scope_type)) ? String(payload.scope_type) : 'workspace'
  const scopeKey = payload.scope_key == null ? null : String(payload.scope_key).trim()
  if (!(await validateScopedRecord(admin, workspace.id, scopeType, scopeKey))) {
    return json(req, 403, { error: 'Requested AI scope is not available in this workspace' }, rateHeaders)
  }

  const conversationId = validKey(typeof payload.conversation_id === 'string' ? payload.conversation_id : null) || `conv_${crypto.randomUUID()}`
  const requestKey = validKey(req.headers.get('x-idempotency-key')) || validKey(typeof payload.request_id === 'string' ? payload.request_id : null) || `ai_${crypto.randomUUID()}`
  const reservation = await reserveIdempotencyKey(admin, requestKey, user.id)
  if (reservation === 'error') return json(req, 503, { error: 'Duplicate-request protection is temporarily unavailable' }, rateHeaders)
  if (reservation === 'duplicate') return json(req, 409, { error: 'This AI request was already accepted. Submit a new request id to ask again.' }, rateHeaders)

  const trustedPayload = {
    question,
    conversation_id: conversationId,
    request_id: requestKey,
    scope_type: scopeType,
    scope_key: scopeKey,
    workspace_id: workspace.id,
    workspace_public_id: workspace.public_id,
    workspace_slug: workspace.slug,
    user_id: user.id,
  }

  try {
    const upstream = await fetch(N8N_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-smart-crm-ingress-token': ingressToken },
      body: JSON.stringify(trustedPayload),
      signal: AbortSignal.timeout(60000),
    })

    if (!upstream.ok) await admin.from('automation_idempotency_keys').delete().eq('idempotency_key', requestKey)
    const responseBody = await upstream.arrayBuffer()
    const responseType = upstream.headers.get('content-type') || 'application/json'
    return new Response(responseBody, { status: upstream.status, headers: { ...corsHeaders(req), 'Content-Type': responseType, ...rateHeaders } })
  } catch (error) {
    await admin.from('automation_idempotency_keys').delete().eq('idempotency_key', requestKey)
    console.error('AI Copilot proxy failed', error)
    return json(req, 502, { error: 'AI Copilot is temporarily unavailable' }, rateHeaders)
  }
})
