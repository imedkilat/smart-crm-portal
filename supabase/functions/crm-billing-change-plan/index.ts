import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@22.6.0'

const PROD_ORIGIN = 'https://smart-crm-portal.vercel.app'
const LOCAL_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])
const MAX_BODY_BYTES = 8 * 1024
const ALLOWED_CYCLES = new Set(['monthly', 'annual'])
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000

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
  workspace_id: string
  plan_id: string
  status: string
  billing_cycle: string
  billing_provider: 'none' | 'manual' | 'stripe'
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  cancel_at_period_end: boolean
  canceled_at: string | null
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

async function stableChangeRequestId(workspaceId: string, userId: string, idempotencyKey: string) {
  const bytes = new TextEncoder().encode(`${workspaceId}:${userId}:${idempotencyKey}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `bchg_${hex.slice(0, 32)}`
}

function loadStripeTestConfig() {
  const mode = Deno.env.get('STRIPE_BILLING_MODE') || ''
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY') || ''

  if (mode !== 'test') return { error: 'Stripe billing changes are not enabled in test mode' as const }
  if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('rk_test_')) {
    return { error: 'Stripe test credentials are not configured' as const }
  }

  return { secretKey }
}

function priceIdFor(plan: PlanRow, billingCycle: 'monthly' | 'annual') {
  return billingCycle === 'annual' ? plan.stripe_price_id_annual : plan.stripe_price_id_monthly
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
  if (price.unit_amount !== Math.round(configuredMajorAmount * 100)) return 'stripe_price_amount_mismatch'

  const expectedInterval = billingCycle === 'annual' ? 'year' : 'month'
  if (!price.recurring || price.recurring.interval !== expectedInterval) return 'stripe_price_interval_mismatch'
  if (price.recurring.interval_count !== 1) return 'stripe_price_interval_count_mismatch'
  if (price.recurring.usage_type !== 'licensed') return 'stripe_price_usage_type_mismatch'

  return null
}

function singleSubscriptionItem(subscription: Stripe.Subscription) {
  const items = subscription.items?.data || []
  if (items.length !== 1) return null
  if (items[0].quantity !== 1) return null
  return items[0]
}

function stripeCancelAt(subscription: Stripe.Subscription) {
  const raw = subscription as unknown as Record<string, unknown>
  return typeof raw.cancel_at === 'number' ? raw.cancel_at : null
}

function stripeScheduleId(subscription: Stripe.Subscription) {
  const raw = subscription as unknown as Record<string, unknown>
  return stripeObjectId(raw.schedule)
}

async function updateRequest(
  admin: ReturnType<typeof createClient<any>>,
  requestId: string,
  values: Record<string, unknown>,
) {
  const { error } = await admin
    .from('billing_change_requests')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('request_id', requestId)

  return error
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
  const targetPlanCode = stringValue(payload.plan_code).toLowerCase()
  const requestedCycle = stringValue(payload.billing_cycle).toLowerCase()

  if (!validUuid(workspaceId)) return json(req, 422, { error: 'Select a valid workspace' })
  if (targetPlanCode !== 'pro') {
    return json(req, 409, { error: 'This billing gate currently supports immediate Starter to Pro upgrades only' })
  }
  if (!ALLOWED_CYCLES.has(requestedCycle)) return json(req, 422, { error: 'Select monthly or annual billing' })

  const targetCycle = requestedCycle as 'monthly' | 'annual'

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

  const { data: subscriptionData, error: subscriptionError } = await admin
    .from('subscriptions')
    .select('workspace_id, plan_id, status, billing_cycle, billing_provider, stripe_customer_id, stripe_subscription_id, cancel_at_period_end, canceled_at')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (subscriptionError) return json(req, 503, { error: 'Subscription state is temporarily unavailable' })
  if (!subscriptionData) return json(req, 409, { error: 'Workspace subscription baseline is missing' })

  const localSubscription = subscriptionData as SubscriptionRow
  if (localSubscription.billing_provider !== 'stripe') {
    return json(req, 409, { error: 'Self-service plan changes require an existing Stripe-managed subscription' })
  }
  if (localSubscription.status !== 'active') {
    return json(req, 409, { error: 'Plan changes require an active Stripe subscription' })
  }
  if (localSubscription.cancel_at_period_end || localSubscription.canceled_at) {
    return json(req, 409, { error: 'Undo the scheduled cancellation before changing plans' })
  }
  if (!localSubscription.stripe_customer_id || !localSubscription.stripe_subscription_id) {
    return json(req, 409, { error: 'Stripe subscription identity requires administrator review' })
  }
  if (!ALLOWED_CYCLES.has(localSubscription.billing_cycle)) {
    return json(req, 409, { error: 'Current billing cycle requires administrator review' })
  }

  const currentCycle = localSubscription.billing_cycle as 'monthly' | 'annual'
  if (targetCycle !== currentCycle) {
    return json(req, 409, {
      error: 'Billing-cycle changes are scheduled at renewal and are handled by the next billing gate',
    })
  }

  const { data: currentPlanData, error: currentPlanError } = await admin
    .from('plans')
    .select('id, code, is_active, is_public, currency_code, price_monthly, price_annual, stripe_product_id, stripe_price_id_monthly, stripe_price_id_annual')
    .eq('id', localSubscription.plan_id)
    .maybeSingle()

  if (currentPlanError) return json(req, 503, { error: 'Current plan lookup is temporarily unavailable' })
  if (!currentPlanData || currentPlanData.code !== 'starter') {
    return json(req, 409, { error: 'This billing gate only upgrades Starter subscriptions to Pro' })
  }

  const { data: targetPlanData, error: targetPlanError } = await admin
    .from('plans')
    .select('id, code, is_active, is_public, currency_code, price_monthly, price_annual, stripe_product_id, stripe_price_id_monthly, stripe_price_id_annual')
    .eq('code', 'pro')
    .eq('is_active', true)
    .eq('is_public', true)
    .maybeSingle()

  if (targetPlanError) return json(req, 503, { error: 'Target plan lookup is temporarily unavailable' })
  if (!targetPlanData) return json(req, 404, { error: 'Pro billing plan is not available' })

  const currentPlan = currentPlanData as PlanRow
  const targetPlan = targetPlanData as PlanRow
  const currentPriceId = priceIdFor(currentPlan, currentCycle)
  const targetPriceId = priceIdFor(targetPlan, targetCycle)

  if (!currentPriceId?.startsWith('price_') || !targetPriceId?.startsWith('price_')) {
    return json(req, 503, { error: 'Stripe test Price mapping is incomplete for this plan change' })
  }

  const requestId = await stableChangeRequestId(workspaceId, user.id, idempotencyKey)
  const staleBefore = new Date(Date.now() - PROCESSING_TIMEOUT_MS).toISOString()
  await admin
    .from('billing_change_requests')
    .update({ status: 'failed', error_code: 'operation_timeout', updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('status', 'processing')
    .lt('updated_at', staleBefore)

  const { data: existingRequest, error: existingRequestError } = await admin
    .from('billing_change_requests')
    .select('request_id, to_plan_id, to_billing_cycle, mode, status, error_code')
    .eq('request_id', requestId)
    .maybeSingle()

  if (existingRequestError) return json(req, 503, { error: 'Billing change idempotency state is temporarily unavailable' })
  if (existingRequest) {
    if (existingRequest.to_plan_id !== targetPlan.id || existingRequest.to_billing_cycle !== targetCycle || existingRequest.mode !== 'immediate') {
      return json(req, 409, { error: 'This idempotency key was already used for a different billing change' })
    }
    if (existingRequest.status === 'applied') {
      return json(req, 200, {
        status: 'applied',
        plan_code: 'pro',
        billing_cycle: targetCycle,
        request_id: requestId,
        idempotent_replay: true,
        mode: 'test',
      })
    }
    if (existingRequest.status === 'processing') {
      return json(req, 409, { error: 'This billing change is already being processed', request_id: requestId })
    }
    return json(req, 409, {
      error: 'This billing change request already finished without applying the upgrade. Retry with a new idempotency key.',
      request_id: requestId,
    })
  }

  const { error: claimError } = await admin.from('billing_change_requests').insert({
    request_id: requestId,
    workspace_id: workspaceId,
    requested_by: user.id,
    from_plan_id: currentPlan.id,
    to_plan_id: targetPlan.id,
    from_billing_cycle: currentCycle,
    to_billing_cycle: targetCycle,
    mode: 'immediate',
    status: 'processing',
    stripe_subscription_id: localSubscription.stripe_subscription_id,
  })

  if (claimError) {
    if (claimError.code === '23505') {
      return json(req, 409, { error: 'Another billing change is already in progress for this workspace' })
    }
    return json(req, 503, { error: 'Billing change request could not be reserved safely' })
  }

  const stripe = new Stripe(stripeConfig.secretKey)

  try {
    const stripeSubscription = await stripe.subscriptions.retrieve(localSubscription.stripe_subscription_id)
    const rawSubscription = stripeSubscription as unknown as Record<string, unknown>

    if (stripeSubscription.livemode) throw new Error('live_subscription_rejected')
    if (stripeObjectId(stripeSubscription.customer) !== localSubscription.stripe_customer_id) {
      throw new Error('stripe_customer_identity_mismatch')
    }
    if (stripeSubscription.status !== 'active') throw new Error('stripe_subscription_not_active')
    if (stripeSubscription.cancel_at_period_end || stripeCancelAt(stripeSubscription)) {
      throw new Error('stripe_subscription_cancel_scheduled')
    }
    if (stripeScheduleId(stripeSubscription)) throw new Error('stripe_subscription_schedule_present')
    if (rawSubscription.pending_update) throw new Error('stripe_subscription_pending_update_present')

    const item = singleSubscriptionItem(stripeSubscription)
    if (!item) throw new Error('stripe_subscription_item_shape_invalid')
    if (item.price.id !== currentPriceId) throw new Error('stripe_current_price_local_mismatch')

    const [currentStripePrice, targetStripePrice] = await Promise.all([
      stripe.prices.retrieve(currentPriceId),
      stripe.prices.retrieve(targetPriceId),
    ])

    const currentValidation = validateStripePrice(currentStripePrice, currentPlan, currentCycle)
    if (currentValidation) throw new Error(`current_${currentValidation}`)
    const targetValidation = validateStripePrice(targetStripePrice, targetPlan, targetCycle)
    if (targetValidation) throw new Error(`target_${targetValidation}`)

    const updated = await stripe.subscriptions.update(
      stripeSubscription.id,
      {
        items: [{ id: item.id, price: targetPriceId, quantity: 1 }],
        payment_behavior: 'pending_if_incomplete',
        proration_behavior: 'always_invoice',
        metadata: {
          smart_crm_last_change_request_id: requestId,
          smart_crm_requested_plan: 'pro',
          smart_crm_requested_cycle: targetCycle,
        },
      },
      { idempotencyKey: `upgrade:${workspaceId}:${idempotencyKey}` },
    )

    const invoiceId = stripeObjectId(updated.latest_invoice)
    const updatedRaw = updated as unknown as Record<string, unknown>

    if (updatedRaw.pending_update) {
      if (!invoiceId) throw new Error('upgrade_pending_invoice_missing')

      await stripe.invoices.voidInvoice(
        invoiceId,
        {},
        { idempotencyKey: `upgrade-void:${workspaceId}:${idempotencyKey}` },
      )

      const rolledBack = await stripe.subscriptions.retrieve(stripeSubscription.id)
      const rolledBackRaw = rolledBack as unknown as Record<string, unknown>
      const rolledBackItem = singleSubscriptionItem(rolledBack)
      if (!rolledBackItem || rolledBackItem.price.id !== currentPriceId || rolledBackRaw.pending_update) {
        throw new Error('upgrade_payment_rollback_unverified')
      }

      await updateRequest(admin, requestId, {
        status: 'failed',
        stripe_invoice_id: invoiceId,
        error_code: 'payment_not_completed',
      })

      return json(req, 402, {
        error: 'The prorated upgrade payment was not completed. Update the payment method and retry.',
        request_id: requestId,
        mode: 'test',
      })
    }

    const appliedItem = singleSubscriptionItem(updated)
    if (!appliedItem || appliedItem.price.id !== targetPriceId) {
      throw new Error('upgrade_result_price_unverified')
    }

    const finalizeError = await updateRequest(admin, requestId, {
      status: 'applied',
      stripe_invoice_id: invoiceId,
      effective_at: new Date().toISOString(),
      error_code: null,
    })
    if (finalizeError) throw new Error('billing_change_request_finalize_failed')

    return json(req, 200, {
      status: 'applied',
      plan_code: 'pro',
      billing_cycle: targetCycle,
      request_id: requestId,
      mode: 'test',
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 120) : 'stripe_upgrade_failed'
    await updateRequest(admin, requestId, { status: 'failed', error_code: reason })
    console.error('Stripe immediate upgrade failed', { reason })
    return json(req, 502, {
      error: 'Stripe test upgrade could not be completed safely. No local plan entitlement was changed by this endpoint.',
      request_id: requestId,
    })
  }
})
