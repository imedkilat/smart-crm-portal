import { createClient } from 'npm:@supabase/supabase-js@2'

const N8N_URL = 'https://tolakautomations.app.n8n.cloud/webhook/smart-crm-status-route'
const PROD_ORIGIN = 'https://smart-crm-portal.vercel.app'
const LOCAL_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])
const ALLOWED_ROUTING_STATUSES = new Set(['Hot', 'Warm', 'Cold'])

function isAllowedOrigin(req: Request) {
  const origin = req.headers.get('origin')
  return !origin || origin === PROD_ORIGIN || LOCAL_ORIGINS.has(origin)
}

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''
  const allowedOrigin = origin === PROD_ORIGIN || LOCAL_ORIGINS.has(origin) ? origin : PROD_ORIGIN
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-idempotency-key, x-workspace-id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function json(req: Request, status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
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

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const token = authHeader.slice('Bearer '.length)
  const { data: { user }, error: userError } = await admin.auth.getUser(token)
  if (userError || !user) return json(req, 401, { error: 'Invalid or expired session' })

  const workspaceResult = await resolveWorkspace(admin, user.id, req.headers.get('x-workspace-id'))
  if ('error' in workspaceResult) {
    const status = workspaceResult.error === 'Workspace access denied' ? 403 : 409
    return json(req, status, { error: workspaceResult.error })
  }
  const { workspace } = workspaceResult

  let payload: Record<string, unknown>
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    payload = parsed as Record<string, unknown>
  } catch {
    return json(req, 400, { error: 'Invalid JSON payload' })
  }

  const leadId = Number(payload.lead_id)
  const routingStatus = typeof payload.routing_status === 'string' ? payload.routing_status.trim() : ''
  if (!Number.isSafeInteger(leadId) || leadId < 1) return json(req, 422, { error: 'lead_id must be a valid lead id' })
  if (!ALLOWED_ROUTING_STATUSES.has(routingStatus)) return json(req, 422, { error: 'routing_status must be Hot, Warm, or Cold' })

  // Never trust the browser-supplied lead object for outbound email/calendar
  // automation. Rehydrate the authoritative lead from the caller's workspace.
  const { data: lead, error: leadError } = await admin
    .from('leads')
    .select('id, public_id, name, email, summary, category, intent, source, workspace_id')
    .eq('id', leadId)
    .eq('workspace_id', workspace.id)
    .maybeSingle()

  if (leadError) return json(req, 503, { error: 'Lead authorization is temporarily unavailable' })
  if (!lead) return json(req, 403, { error: 'Lead is not available in this workspace' })

  const trustedPayload = {
    ...payload,
    lead_id: lead.id,
    routing_status: routingStatus,
    lead: {
      id: lead.id,
      public_id: lead.public_id,
      name: lead.name,
      email: lead.email,
      summary: lead.summary,
      category: lead.category,
      intent: lead.intent,
      source: lead.source,
    },
    workspace_id: workspace.id,
    workspace_public_id: workspace.public_id,
    workspace_slug: workspace.slug,
    user_id: user.id,
  }

  try {
    const upstream = await fetch(N8N_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-smart-crm-ingress-token': ingressToken,
      },
      body: JSON.stringify(trustedPayload),
      signal: AbortSignal.timeout(60000),
    })

    const responseBody = await upstream.arrayBuffer()
    const responseType = upstream.headers.get('content-type') || 'application/json'
    return new Response(responseBody, {
      status: upstream.status,
      headers: { ...corsHeaders(req), 'Content-Type': responseType },
    })
  } catch (error) {
    console.error('Status routing proxy failed', error)
    return json(req, 502, { error: 'Routing automation is temporarily unavailable' })
  }
})
