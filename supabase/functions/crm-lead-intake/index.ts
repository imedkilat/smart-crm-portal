import { createClient } from 'npm:@supabase/supabase-js@2'

const N8N_URL = 'https://tolakautomations.app.n8n.cloud/webhook/799b1d66-0a5f-44b0-8f43-600ea4775979'
const PROD_ORIGIN = 'https://smart-crm-portal.vercel.app'
const LOCAL_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])

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
  const ingressToken = Deno.env.get('N8N_LEAD_INGRESS_TOKEN') || ''
  if (!supabaseUrl || !serviceRoleKey) return json(req, 500, { error: 'Server auth is not configured' })
  if (!ingressToken) return json(req, 500, { error: 'Lead automation ingress is not configured' })

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

  try {
    const contentType = req.headers.get('content-type') || ''
    let upstreamBody: BodyInit
    const upstreamHeaders: Record<string, string> = {
      'x-smart-crm-ingress-token': ingressToken,
    }

    if (contentType.toLowerCase().includes('multipart/form-data')) {
      const form = await req.formData()
      form.set('workspace_id', workspace.id)
      form.set('workspace_public_id', workspace.public_id)
      form.set('workspace_slug', workspace.slug)
      form.set('user_id', user.id)
      upstreamBody = form
      // Do not forward the original multipart content-type boundary. fetch()
      // generates the correct boundary for the reconstructed FormData body.
    } else {
      let payload: Record<string, unknown>
      try {
        payload = await req.json()
      } catch {
        return json(req, 400, { error: 'Invalid JSON payload' })
      }

      upstreamBody = JSON.stringify({
        ...payload,
        workspace_id: workspace.id,
        workspace_public_id: workspace.public_id,
        workspace_slug: workspace.slug,
        user_id: user.id,
      })
      upstreamHeaders['content-type'] = 'application/json'
    }

    const upstream = await fetch(N8N_URL, {
      method: 'POST',
      headers: upstreamHeaders,
      body: upstreamBody,
      signal: AbortSignal.timeout(60000),
    })

    const responseBody = await upstream.arrayBuffer()
    const responseType = upstream.headers.get('content-type') || 'application/json'
    return new Response(responseBody, {
      status: upstream.status,
      headers: { ...corsHeaders(req), 'Content-Type': responseType },
    })
  } catch (error) {
    console.error('Lead intake proxy failed', error)
    return json(req, 502, { error: 'Lead intake automation is temporarily unavailable' })
  }
})
