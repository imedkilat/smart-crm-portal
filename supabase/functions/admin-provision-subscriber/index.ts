import { createClient } from 'npm:@supabase/supabase-js@2'

const PROD_ORIGIN = 'https://smart-crm-portal.vercel.app'
const LOCAL_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])
const MAX_BODY_BYTES = 8 * 1024
const ALLOWED_PLANS = new Set(['free', 'starter', 'pro', 'white_label'])
const ALLOWED_BILLING_CYCLES = new Set(['monthly', 'annual', 'custom', 'none'])

function isAllowedOrigin(req: Request) {
  const origin = req.headers.get('origin')
  return !origin || origin === PROD_ORIGIN || LOCAL_ORIGINS.has(origin)
}

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || PROD_ORIGIN
  const allowedOrigin = origin === PROD_ORIGIN || LOCAL_ORIGINS.has(origin) ? origin : PROD_ORIGIN
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function validEmail(value: string) {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'Method not allowed' })
  if (!isAllowedOrigin(req)) return json(req, 403, { error: 'Origin not allowed' })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json(req, 401, { error: 'Authentication required' })

  const contentLength = Number(req.headers.get('content-length') || '0')
  if (contentLength > MAX_BODY_BYTES) return json(req, 413, { error: 'Request payload is too large' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!supabaseUrl || !serviceRoleKey) return json(req, 500, { error: 'Server auth is not configured' })

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const token = authHeader.slice('Bearer '.length)
  const { data: { user }, error: userError } = await admin.auth.getUser(token)
  if (userError || !user) return json(req, 401, { error: 'Invalid or expired session' })

  // app_metadata is controlled by trusted server/admin operations. Never use
  // user_metadata for platform authorization because users can edit it.
  if (user.app_metadata?.platform_role !== 'platform_admin') {
    return json(req, 403, { error: 'Platform administrator access required' })
  }

  let payload: Record<string, unknown>
  try {
    const raw = await req.text()
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json(req, 413, { error: 'Request payload is too large' })
    }
    payload = JSON.parse(raw)
  } catch {
    return json(req, 400, { error: 'Invalid JSON payload' })
  }

  const email = stringValue(payload.email).toLowerCase()
  const workspaceName = stringValue(payload.workspace_name)
  const planCode = stringValue(payload.plan_code).toLowerCase()
  let billingCycle = stringValue(payload.billing_cycle).toLowerCase() || 'monthly'
  let deploymentType = planCode === 'white_label' ? 'white_label' : 'hosted'

  if (!validEmail(email)) return json(req, 422, { error: 'Enter a valid subscriber email' })
  if (workspaceName.length < 2 || workspaceName.length > 100) {
    return json(req, 422, { error: 'Workspace name must be 2 to 100 characters' })
  }
  if (!ALLOWED_PLANS.has(planCode)) return json(req, 422, { error: 'Select an active subscriber plan' })
  if (!ALLOWED_BILLING_CYCLES.has(billingCycle)) return json(req, 422, { error: 'Select a supported billing cycle' })

  if (planCode === 'white_label') billingCycle = 'custom'
  if (planCode === 'free') billingCycle = 'none'
  if (planCode !== 'white_label') deploymentType = 'hosted'

  const { data: requestRows, error: requestError } = await admin.rpc('create_subscriber_provisioning_request', {
    p_email: email,
    p_workspace_name: workspaceName,
    p_plan_code: planCode,
    p_billing_cycle: billingCycle,
    p_deployment_type: deploymentType,
    p_invited_by: user.id,
  })

  const provisioning = requestRows?.[0]
  if (requestError || !provisioning) {
    console.error('Subscriber provisioning request failed', { code: requestError?.code })
    return json(req, 500, { error: 'Could not create the subscriber invitation' })
  }

  if (provisioning.request_status === 'invited') {
    return json(req, 200, {
      request_id: provisioning.request_public_id,
      email,
      workspace_name: workspaceName,
      plan_code: planCode,
      billing_cycle: billingCycle,
      status: 'invitation_already_sent',
      expires_at: provisioning.expires_at,
    })
  }

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${PROD_ORIGIN}/reset-password`,
    data: {
      workspace_name: workspaceName,
      provisioning_request_id: provisioning.request_public_id,
    },
  })

  if (inviteError) {
    await admin
      .from('subscriber_provisioning_requests')
      .update({ status: 'cancelled', last_error: inviteError.message })
      .eq('id', provisioning.request_id)
      .eq('status', 'pending')

    await admin.from('billing_events').insert({
      event_type: 'manual_provisioning.invite_failed',
      payload: {
        request_public_id: provisioning.request_public_id,
        email,
        plan_code: planCode,
        invited_by: user.id,
      },
      processed_at: new Date().toISOString(),
      error_message: inviteError.message,
    })

    console.error('Subscriber Auth invite failed', { code: inviteError.code })
    const conflict = /already|registered|exists/i.test(inviteError.message)
    return json(req, conflict ? 409 : 502, {
      error: conflict
        ? 'An account already exists for this email. Use the existing-customer plan flow instead.'
        : 'The invitation could not be sent. No entitlement was activated.',
    })
  }


  const { error: invitationStateError } = await admin
    .from('subscriber_provisioning_requests')
    .update({ status: 'invited', last_error: null })
    .eq('id', provisioning.request_id)
    .eq('status', 'pending')

  if (invitationStateError) {
    console.error('Subscriber invitation state update failed', { code: invitationStateError.code })
    return json(req, 500, {
      error: 'The invite was sent, but its entitlement state needs administrator review before first login.',
      request_id: provisioning.request_public_id,
    })
  }

  await admin.from('billing_events').insert({
    event_type: 'manual_provisioning.invite_sent',
    payload: {
      request_public_id: provisioning.request_public_id,
      email,
      plan_code: planCode,
      invited_by: user.id,
    },
    processed_at: new Date().toISOString(),
  })

  return json(req, 201, {
    request_id: provisioning.request_public_id,
    email,
    workspace_name: workspaceName,
    plan_code: planCode,
    billing_cycle: billingCycle,
    status: 'invitation_sent',
    expires_at: provisioning.expires_at,
  })
})
