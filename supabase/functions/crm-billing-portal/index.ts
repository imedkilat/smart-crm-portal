import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@22.6.0'

const PROD_ORIGIN = 'https://smart-crm-portal.vercel.app'
const LOCAL_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])
const MAX_BODY_BYTES = 4 * 1024

type SubscriptionRow = {
  billing_provider: 'none' | 'manual' | 'stripe'
  status: string
  stripe_customer_id: string | null
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

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function loadStripeTestConfig() {
  const mode = Deno.env.get('STRIPE_BILLING_MODE') || ''
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY') || ''

  if (mode !== 'test') return { error: 'Stripe billing is not enabled in test mode' as const }
  if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('rk_test_')) {
    return { error: 'Stripe test credentials are not configured' as const }
  }

  return { secretKey }
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

  const stripeConfig = loadStripeTestConfig()
  if ('error' in stripeConfig) return json(req, 503, { error: stripeConfig.error })

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const token = authHeader.slice('Bearer '.length)
  const { data: { user }, error: userError } = await admin.auth.getUser(token)
  if (userError || !user) return json(req, 401, { error: 'Invalid or expired session' })

  let payload: Record<string, unknown>
  try {
    const raw = await req.text()
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json(req, 413, { error: 'Request payload is too large' })
    }
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    return json(req, 400, { error: 'Invalid JSON payload' })
  }

  const workspaceId = stringValue(payload.workspace_id)
  if (!validUuid(workspaceId)) return json(req, 422, { error: 'Select a valid workspace' })

  const { data: membership, error: membershipError } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membershipError) return json(req, 503, { error: 'Workspace authorization is temporarily unavailable' })
  if (!membership || !['owner', 'admin'].includes(String(membership.role))) {
    return json(req, 403, { error: 'Workspace owner or administrator access required' })
  }

  const { data: currentSubscription, error: subscriptionError } = await admin
    .from('subscriptions')
    .select('billing_provider, status, stripe_customer_id')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (subscriptionError) return json(req, 503, { error: 'Subscription state is temporarily unavailable' })
  if (!currentSubscription) return json(req, 409, { error: 'Workspace subscription baseline is missing' })

  const subscription = currentSubscription as SubscriptionRow
  if (subscription.billing_provider !== 'stripe' || !subscription.stripe_customer_id) {
    return json(req, 409, {
      error: 'This workspace does not have a Stripe-managed billing relationship',
      billing_provider: subscription.billing_provider,
      subscription_status: subscription.status,
    })
  }

  const stripe = new Stripe(stripeConfig.secretKey)
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${PROD_ORIGIN}/settings?billing=portal-return`,
    })

    return json(req, 201, {
      portal_url: session.url,
      mode: 'test',
    })
  } catch (error) {
    const stripeError = error as { type?: string; code?: string }
    console.error('Stripe billing portal creation failed', { type: stripeError.type, code: stripeError.code })
    return json(req, 502, { error: 'Stripe test billing portal is temporarily unavailable' })
  }
})
