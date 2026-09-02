import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@22.6.0'

const PROD_ORIGIN = 'https://smart-crm-portal.vercel.app'
const LOCAL_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])
const MAX_BODY_BYTES = 8 * 1024
const ALLOWED_PLANS = new Set(['starter', 'pro'])
const ALLOWED_CYCLES = new Set(['monthly', 'annual'])

type PlanRow = {
  id: string
  code: string
  is_active: boolean
  is_public: boolean
  currency_code: string
  price_monthly: number | string | null
  price_annual: number | string | null
  stripe_product_id: string | null
  stripe_price_id_monthly: string | null
  stripe_price_id_annual: string | null
}

type SubscriptionRow = {
  billing_provider: 'none' | 'manual' | 'stripe'
  status: string
  billing_cycle: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
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

function validIdempotencyKey(value: string | null) {
  if (!value) return null
  const key = value.trim()
  return /^[A-Za-z0-9:_-]{8,128}$/.test(key) ? key : null
}

function stripeObjectId(value: unknown) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id
  return null
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

function validateStripePrice(price: Stripe.Price, plan: PlanRow, billingCycle: 'monthly' | 'annual') {
  if (!price.active) return 'stripe_price_inactive'
  if (!plan.stripe_product_id?.startsWith('prod_')) return 'stripe_product_mapping_missing'
  if (stripeObjectId(price.product) !== plan.stripe_product_id) return 'stripe_product_mapping_mismatch'

  const currency = plan.currency_code.trim().toUpperCase()
  if (currency !== 'USD') return 'unsupported_billing_currency'
  if (price.currency.toUpperCase() !== currency) return 'stripe_price_currency_mismatch'

  const configuredMajorAmount = Number(billingCycle === 'annual' ? plan.price_annual : plan.price_monthly)
  if (!Number.isFinite(configuredMajorAmount) || configuredMajorAmount < 0) return 'local_plan_amount_invalid'
  const expectedUnitAmount = Math.round(configuredMajorAmount * 100)
  if (price.unit_amount !== expectedUnitAmount) return 'stripe_price_amount_mismatch'

  const expectedInterval = billingCycle === 'annual' ? 'year' : 'month'
  if (!price.recurring || price.recurring.interval !== expectedInterval) return 'stripe_price_interval_mismatch'
  if (price.recurring.interval_count !== 1) return 'stripe_price_interval_count_mismatch'
  if (price.recurring.usage_type !== 'licensed') return 'stripe_price_usage_type_mismatch'

  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'Method not allowed' })
  if (!isAllowedOrigin(req)) return json(req, 403, { error: 'Origin not allowed' })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json(req, 401, { error: 'Authentication required' })

  const idempotencyKey = validIdempotencyKey(req.headers.get('x-idempotency-key'))
  if (!idempotencyKey) return json(req, 422, { error: 'A valid x-idempotency-key is required' })

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
    payload = JSON.parse(raw)
  } catch {
    return json(req, 400, { error: 'Invalid JSON payload' })
  }

  const workspaceId = stringValue(payload.workspace_id)
  const planCode = stringValue(payload.plan_code).toLowerCase()
  const billingCycle = stringValue(payload.billing_cycle).toLowerCase()

  if (!validUuid(workspaceId)) return json(req, 422, { error: 'Select a valid workspace' })
  if (!ALLOWED_PLANS.has(planCode)) return json(req, 422, { error: 'Stripe Checkout currently supports Starter or Pro only' })
  if (!ALLOWED_CYCLES.has(billingCycle)) return json(req, 422, { error: 'Select monthly or annual billing' })

  const trustedBillingCycle = billingCycle as 'monthly' | 'annual'

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

  const { data: plan, error: planError } = await admin
    .from('plans')
    .select('id, code, is_active, is_public, currency_code, price_monthly, price_annual, stripe_product_id, stripe_price_id_monthly, stripe_price_id_annual')
    .eq('code', planCode)
    .eq('is_active', true)
    .eq('is_public', true)
    .maybeSingle()

  if (planError) return json(req, 503, { error: 'Billing plan lookup is temporarily unavailable' })
  if (!plan) return json(req, 404, { error: 'Billing plan is not available' })

  const trustedPlan = plan as PlanRow
  const priceId = trustedBillingCycle === 'annual'
    ? trustedPlan.stripe_price_id_annual
    : trustedPlan.stripe_price_id_monthly

  if (!priceId || !priceId.startsWith('price_') || !trustedPlan.stripe_product_id?.startsWith('prod_')) {
    return json(req, 503, {
      error: 'Stripe test Product/Price mapping is not configured for this plan and billing cycle',
      plan_code: planCode,
      billing_cycle: trustedBillingCycle,
    })
  }

  const { data: currentSubscription, error: subscriptionError } = await admin
    .from('subscriptions')
    .select('billing_provider, status, billing_cycle, stripe_customer_id, stripe_subscription_id')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (subscriptionError) return json(req, 503, { error: 'Subscription state is temporarily unavailable' })
  if (!currentSubscription) return json(req, 409, { error: 'Workspace subscription baseline is missing' })

  const subscription = currentSubscription as SubscriptionRow
  if (subscription.billing_provider === 'manual') {
    return json(req, 409, {
      error: 'This workspace is manually billed and cannot be converted through self-service Checkout',
      billing_provider: subscription.billing_provider,
    })
  }

  if (subscription.billing_provider === 'stripe') {
    return json(req, 409, {
      error: 'This workspace already has a Stripe billing relationship. Use the billing portal instead.',
      billing_provider: subscription.billing_provider,
      subscription_status: subscription.status,
    })
  }

  if (subscription.billing_provider !== 'none' || subscription.billing_cycle !== 'none') {
    return json(req, 409, { error: 'Subscription provider state requires administrator review before Checkout' })
  }

  if (subscription.stripe_customer_id || subscription.stripe_subscription_id) {
    return json(req, 409, { error: 'Subscription identity requires administrator review before Checkout' })
  }

  const stripe = new Stripe(stripeConfig.secretKey)
  const metadata = {
    workspace_id: workspaceId,
    plan_code: planCode,
    billing_cycle: trustedBillingCycle,
    requested_by: user.id,
  }

  try {
    const stripePrice = await stripe.prices.retrieve(priceId)
    const pricingValidationError = validateStripePrice(stripePrice, trustedPlan, trustedBillingCycle)
    if (pricingValidationError) {
      console.error('Stripe test price mapping validation failed', {
        planCode,
        billingCycle: trustedBillingCycle,
        reason: pricingValidationError,
      })
      return json(req, 503, {
        error: 'Stripe test pricing mapping failed validation',
        pricing_reason: pricingValidationError,
      })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: workspaceId,
      customer_email: user.email || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      subscription_data: { metadata },
      success_url: `${PROD_ORIGIN}/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PROD_ORIGIN}/settings?billing=cancelled`,
    }, {
      idempotencyKey: `checkout:${workspaceId}:${idempotencyKey}`,
    })

    if (!session.url) {
      console.error('Stripe Checkout session has no URL', { sessionId: session.id })
      return json(req, 502, { error: 'Stripe Checkout did not return a redirect URL' })
    }

    return json(req, 201, {
      checkout_session_id: session.id,
      checkout_url: session.url,
      plan_code: planCode,
      billing_cycle: trustedBillingCycle,
      mode: 'test',
    })
  } catch (error) {
    const stripeError = error as { type?: string; code?: string }
    console.error('Stripe Checkout creation failed', { type: stripeError.type, code: stripeError.code })
    return json(req, 502, { error: 'Stripe test Checkout is temporarily unavailable' })
  }
})
