import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@22.6.0'

const PROD_ORIGIN = 'https://smart-crm-portal.vercel.app'
const LOCAL_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])
const MAX_BODY_BYTES = 8 * 1024
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000
const ALLOWED_CYCLES = new Set(['monthly', 'annual'])
const ALLOWED_PLAN_CODES = new Set(['starter', 'pro'])

type BillingCycle = 'monthly' | 'annual'
type PlanRow = {
  id: string
  code: string
  is_active: boolean
  is_public: boolean
  currency_code: string
  price_monthly: number | string | null
  price_annual: number | string | null
  max_seats: number | null
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

function allowedOrigin(req: Request) {
  const origin = req.headers.get('origin')
  return !origin || origin === PROD_ORIGIN || LOCAL_ORIGINS.has(origin)
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

function objectId(value: unknown) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id
  return null
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

async function stableChangeRequestId(workspaceId: string, userId: string, idempotencyKey: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${workspaceId}:${userId}:${idempotencyKey}`),
  )
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `bchg_${hex.slice(0, 32)}`
}

function priceIdFor(plan: PlanRow, cycle: BillingCycle) {
  return cycle === 'annual' ? plan.stripe_price_id_annual : plan.stripe_price_id_monthly
}

function validateStripePrice(price: Stripe.Price, plan: PlanRow, cycle: BillingCycle) {
  if (!price.active) return 'stripe_price_inactive'
  if (!plan.stripe_product_id?.startsWith('prod_')) return 'stripe_product_mapping_missing'
  if (objectId(price.product) !== plan.stripe_product_id) return 'stripe_product_mapping_mismatch'
  if (plan.currency_code.trim().toUpperCase() !== 'USD') return 'unsupported_billing_currency'
  if (price.currency.toUpperCase() !== 'USD') return 'stripe_price_currency_mismatch'

  const configuredAmount = Number(cycle === 'annual' ? plan.price_annual : plan.price_monthly)
  if (!Number.isFinite(configuredAmount) || configuredAmount < 0) return 'local_plan_amount_invalid'
  if (price.unit_amount !== Math.round(configuredAmount * 100)) return 'stripe_price_amount_mismatch'

  const interval = cycle === 'annual' ? 'year' : 'month'
  if (!price.recurring || price.recurring.interval !== interval) return 'stripe_price_interval_mismatch'
  if (price.recurring.interval_count !== 1) return 'stripe_price_interval_count_mismatch'
  if (price.recurring.usage_type !== 'licensed') return 'stripe_price_usage_type_mismatch'
  return null
}

function singleSubscriptionItem(subscription: Stripe.Subscription) {
  const items = subscription.items?.data || []
  if (items.length !== 1 || items[0].quantity !== 1) return null
  return items[0]
}

function subscriptionPeriod(subscription: Stripe.Subscription) {
  const item = singleSubscriptionItem(subscription) as unknown as Record<string, unknown> | null
  const raw = subscription as unknown as Record<string, unknown>
  const start = item?.current_period_start ?? raw.current_period_start
  const end = item?.current_period_end ?? raw.current_period_end
  return {
    start: typeof start === 'number' && Number.isFinite(start) ? start : null,
    end: typeof end === 'number' && Number.isFinite(end) ? end : null,
  }
}

function stripeCancelAt(subscription: Stripe.Subscription) {
  const value = (subscription as unknown as Record<string, unknown>).cancel_at
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stripeScheduleId(subscription: Stripe.Subscription) {
  return objectId((subscription as unknown as Record<string, unknown>).schedule)
}

function unsupportedBillingShape(subscription: Stripe.Subscription) {
  const item = singleSubscriptionItem(subscription)
  if (!item) return 'stripe_subscription_item_shape_invalid'
  if (subscription.collection_method !== 'charge_automatically') return 'unsupported_collection_method'
  if ((subscription.discounts || []).length) return 'discounted_subscription_requires_admin_review'
  if ((subscription.default_tax_rates || []).length) return 'taxed_subscription_requires_admin_review'
  if ((item.discounts || []).length) return 'discounted_subscription_item_requires_admin_review'
  if ((item.tax_rates || []).length) return 'taxed_subscription_item_requires_admin_review'
  if (subscription.automatic_tax?.enabled) return 'automatic_tax_subscription_requires_admin_review'
  if (subscription.pause_collection) return 'paused_collection_requires_admin_review'
  if (subscription.trial_end) return 'trial_subscription_requires_admin_review'
  return null
}

function phasePriceId(phase: Stripe.SubscriptionSchedule.Phase) {
  const items = phase.items || []
  if (items.length !== 1 || items[0].quantity !== 1) return null
  return objectId(items[0].price || items[0].plan)
}

function phaseMetadata(phase: Stripe.SubscriptionSchedule.Phase) {
  const result: Record<string, string> = {}
  if (!phase.metadata || typeof phase.metadata !== 'object') return result
  for (const [key, value] of Object.entries(phase.metadata)) {
    if (typeof value === 'string') result[key] = value
  }
  return result
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
  if (!allowedOrigin(req)) return json(req, 403, { error: 'Origin not allowed' })

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
  const action = stringValue(payload.action).toLowerCase() || 'schedule'
  if (!validUuid(workspaceId)) return json(req, 422, { error: 'Select a valid workspace' })
  if (!['schedule', 'cancel'].includes(action)) return json(req, 422, { error: 'Select a valid billing change action' })

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

  const local = subscriptionData as SubscriptionRow
  if (local.billing_provider !== 'stripe') return json(req, 409, { error: 'Self-service plan changes require an existing Stripe-managed subscription' })
  if (local.status !== 'active') return json(req, 409, { error: 'Plan changes require an active Stripe subscription' })
  if (local.cancel_at_period_end || local.canceled_at) return json(req, 409, { error: 'Undo the scheduled cancellation before changing plans' })
  if (!local.stripe_customer_id || !local.stripe_subscription_id) return json(req, 409, { error: 'Stripe subscription identity requires administrator review' })
  if (!ALLOWED_CYCLES.has(local.billing_cycle)) return json(req, 409, { error: 'Current billing cycle requires administrator review' })

  const stripe = new Stripe(stripeConfig.secretKey)

  if (action === 'cancel') {
    const { data: request, error: requestError } = await admin
      .from('billing_change_requests')
      .select('request_id, stripe_subscription_id, stripe_subscription_schedule_id, effective_at')
      .eq('workspace_id', workspaceId)
      .eq('mode', 'scheduled')
      .eq('status', 'scheduled')
      .maybeSingle()
    if (requestError) return json(req, 503, { error: 'Scheduled billing change lookup is temporarily unavailable' })
    if (!request) return json(req, 200, { status: 'no_scheduled_change', mode: 'test' })
    if (!request.stripe_subscription_schedule_id || request.stripe_subscription_id !== local.stripe_subscription_id) {
      return json(req, 409, { error: 'Scheduled change Stripe identity requires administrator review' })
    }

    try {
      const stripeSubscription = await stripe.subscriptions.retrieve(local.stripe_subscription_id)
      if (stripeSubscription.livemode) throw new Error('live_subscription_rejected')
      if (objectId(stripeSubscription.customer) !== local.stripe_customer_id) throw new Error('stripe_customer_identity_mismatch')

      const attachedScheduleId = stripeScheduleId(stripeSubscription)
      let releasedSchedule: Stripe.SubscriptionSchedule

      if (attachedScheduleId) {
        if (attachedScheduleId !== request.stripe_subscription_schedule_id) {
          throw new Error('stripe_schedule_identity_mismatch')
        }
        if (request.effective_at && new Date(request.effective_at).getTime() <= Date.now()) {
          return json(req, 409, { error: 'The scheduled change is already taking effect. Refresh billing state before retrying.' })
        }

        releasedSchedule = await stripe.subscriptionSchedules.release(
          attachedScheduleId,
          { preserve_cancel_date: false },
          { idempotencyKey: `schedule-release:${workspaceId}:${idempotencyKey}` },
        )
      } else {
        // Recovery path: Stripe may already have released the known schedule while
        // the local cancellation-finalization write failed. Re-read that exact
        // schedule and treat a verified released state as an idempotent retry.
        const knownSchedule = await stripe.subscriptionSchedules.retrieve(
          request.stripe_subscription_schedule_id,
        )
        if (knownSchedule.livemode || knownSchedule.status !== 'released') {
          throw new Error('stripe_schedule_release_state_unverified')
        }
        releasedSchedule = knownSchedule
      }

      if (releasedSchedule.livemode || releasedSchedule.status !== 'released') {
        throw new Error('stripe_schedule_release_unverified')
      }
      if (objectId(releasedSchedule.released_subscription) !== local.stripe_subscription_id) {
        throw new Error('stripe_schedule_released_subscription_mismatch')
      }

      const finalizeError = await updateRequest(admin, request.request_id, { status: 'canceled', error_code: null })
      if (finalizeError) throw new Error('billing_change_request_cancel_finalize_failed')
      return json(req, 200, { status: 'canceled', request_id: request.request_id, mode: 'test' })
    } catch (error) {
      console.error('Stripe scheduled change cancellation failed', {
        reason: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
      })
      return json(req, 502, { error: 'The scheduled Stripe test change could not be canceled safely. Refresh billing state before retrying.' })
    }
  }

  const targetPlanCode = stringValue(payload.plan_code).toLowerCase()
  const targetCycleValue = stringValue(payload.billing_cycle).toLowerCase()
  if (!ALLOWED_PLAN_CODES.has(targetPlanCode)) return json(req, 422, { error: 'Select Starter or Pro' })
  if (!ALLOWED_CYCLES.has(targetCycleValue)) return json(req, 422, { error: 'Select monthly or annual billing' })

  const currentCycle = local.billing_cycle as BillingCycle
  const targetCycle = targetCycleValue as BillingCycle

  const planColumns = 'id, code, is_active, is_public, currency_code, price_monthly, price_annual, max_seats, stripe_product_id, stripe_price_id_monthly, stripe_price_id_annual'
  const [{ data: currentPlanData, error: currentPlanError }, { data: targetPlanData, error: targetPlanError }] = await Promise.all([
    admin.from('plans').select(planColumns).eq('id', local.plan_id).maybeSingle(),
    admin.from('plans').select(planColumns).eq('code', targetPlanCode).eq('is_active', true).eq('is_public', true).maybeSingle(),
  ])
  if (currentPlanError || targetPlanError) return json(req, 503, { error: 'Billing plan lookup is temporarily unavailable' })
  if (!currentPlanData || !ALLOWED_PLAN_CODES.has(String(currentPlanData.code))) return json(req, 409, { error: 'Current plan is not eligible for self-service scheduling' })
  if (!targetPlanData) return json(req, 404, { error: 'Target billing plan is not available' })

  const currentPlan = currentPlanData as PlanRow
  const targetPlan = targetPlanData as PlanRow
  if (currentPlan.id === targetPlan.id && currentCycle === targetCycle) return json(req, 409, { error: 'The workspace is already on that plan and billing cycle' })
  if (currentPlan.code === 'starter' && targetPlan.code === 'pro' && currentCycle === targetCycle) {
    return json(req, 409, { error: 'Same-cycle Starter to Pro upgrades use the immediate prorated upgrade endpoint' })
  }

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

  const { data: existing, error: existingError } = await admin
    .from('billing_change_requests')
    .select('request_id, to_plan_id, to_billing_cycle, mode, status, effective_at')
    .eq('request_id', requestId)
    .maybeSingle()
  if (existingError) return json(req, 503, { error: 'Billing change idempotency state is temporarily unavailable' })
  if (existing) {
    if (existing.to_plan_id !== targetPlan.id || existing.to_billing_cycle !== targetCycle || existing.mode !== 'scheduled') {
      return json(req, 409, { error: 'This idempotency key was already used for a different billing change' })
    }
    if (existing.status === 'scheduled' || existing.status === 'applied') {
      return json(req, 200, {
        status: existing.status,
        plan_code: targetPlan.code,
        billing_cycle: targetCycle,
        effective_at: existing.effective_at,
        request_id: requestId,
        idempotent_replay: true,
        mode: 'test',
      })
    }
    if (existing.status === 'processing') return json(req, 409, { error: 'This billing change is already being processed', request_id: requestId })
    return json(req, 409, { error: 'This billing change request already finished. Retry with a new idempotency key.', request_id: requestId })
  }

  let createdScheduleId: string | null = null
  try {
    const stripeSubscription = await stripe.subscriptions.retrieve(local.stripe_subscription_id)
    const rawSubscription = stripeSubscription as unknown as Record<string, unknown>
    if (stripeSubscription.livemode) throw new Error('live_subscription_rejected')
    if (objectId(stripeSubscription.customer) !== local.stripe_customer_id) throw new Error('stripe_customer_identity_mismatch')
    if (stripeSubscription.status !== 'active') throw new Error('stripe_subscription_not_active')
    if (stripeSubscription.cancel_at_period_end || stripeCancelAt(stripeSubscription)) throw new Error('stripe_subscription_cancel_scheduled')
    if (stripeScheduleId(stripeSubscription)) throw new Error('stripe_subscription_schedule_present')
    if (rawSubscription.pending_update) throw new Error('stripe_subscription_pending_update_present')

    const shapeError = unsupportedBillingShape(stripeSubscription)
    if (shapeError) throw new Error(shapeError)
    const item = singleSubscriptionItem(stripeSubscription)
    if (!item || item.price.id !== currentPriceId) throw new Error('stripe_current_price_local_mismatch')

    const period = subscriptionPeriod(stripeSubscription)
    if (!period.start || !period.end || period.end <= Math.floor(Date.now() / 1000)) throw new Error('stripe_subscription_period_invalid')

    const [currentStripePrice, targetStripePrice] = await Promise.all([
      stripe.prices.retrieve(currentPriceId),
      stripe.prices.retrieve(targetPriceId),
    ])
    const currentValidation = validateStripePrice(currentStripePrice, currentPlan, currentCycle)
    if (currentValidation) throw new Error(`current_${currentValidation}`)
    const targetValidation = validateStripePrice(targetStripePrice, targetPlan, targetCycle)
    if (targetValidation) throw new Error(`target_${targetValidation}`)

    const reserve = await admin.rpc('reserve_scheduled_billing_change_request', {
      p_request_id: requestId,
      p_workspace_id: workspaceId,
      p_requested_by: user.id,
      p_from_plan_id: currentPlan.id,
      p_to_plan_id: targetPlan.id,
      p_from_billing_cycle: currentCycle,
      p_to_billing_cycle: targetCycle,
      p_stripe_subscription_id: stripeSubscription.id,
    })
    if (reserve.error) {
      if (String(reserve.error.message || '').includes('Target plan seat limit exceeded')) {
        return json(req, 409, { error: `This workspace has too many members for ${targetPlan.code}. Remove members before scheduling the change.` })
      }
      if (reserve.error.code === '23505') return json(req, 409, { error: 'Another billing change is already active for this workspace' })
      throw new Error(`billing_change_reservation_failed:${reserve.error.code || 'unknown'}`)
    }

    const created = await stripe.subscriptionSchedules.create(
      { from_subscription: stripeSubscription.id },
      { idempotencyKey: `schedule-create:${workspaceId}:${idempotencyKey}` },
    )
    createdScheduleId = created.id
    if (created.livemode || objectId(created.subscription) !== stripeSubscription.id) throw new Error('stripe_schedule_creation_identity_mismatch')

    const persistScheduleIdError = await updateRequest(admin, requestId, { stripe_subscription_schedule_id: created.id })
    if (persistScheduleIdError) throw new Error('billing_schedule_id_persist_failed')

    const scheduled = await stripe.subscriptionSchedules.update(
      created.id,
      {
        end_behavior: 'release',
        proration_behavior: 'none',
        phases: [
          {
            items: [{ price: currentPriceId, quantity: 1 }],
            start_date: period.start,
            end_date: period.end,
            proration_behavior: 'none',
          },
          {
            items: [{ price: targetPriceId, quantity: 1 }],
            start_date: period.end,
            duration: {
              interval: targetCycle === 'annual' ? 'year' : 'month',
              interval_count: 1,
            },
            billing_cycle_anchor: 'phase_start',
            proration_behavior: 'none',
            metadata: {
              workspace_id: workspaceId,
              smart_crm_last_change_request_id: requestId,
              smart_crm_requested_plan: targetPlan.code,
              smart_crm_requested_cycle: targetCycle,
            },
          },
        ],
      },
      { idempotencyKey: `schedule-update:${workspaceId}:${idempotencyKey}` },
    )

    if (scheduled.livemode || scheduled.status !== 'active') throw new Error('stripe_schedule_not_active')
    if (scheduled.end_behavior !== 'release') throw new Error('stripe_schedule_end_behavior_invalid')
    if (objectId(scheduled.subscription) !== stripeSubscription.id) throw new Error('stripe_schedule_subscription_mismatch')

    const currentPhase = scheduled.phases.find((phase) => phase.start_date === period.start && phase.end_date === period.end)
    const futurePhase = scheduled.phases.find((phase) => phase.start_date === period.end && phasePriceId(phase) === targetPriceId)
    if (!currentPhase || phasePriceId(currentPhase) !== currentPriceId) throw new Error('stripe_schedule_current_phase_unverified')
    if (!futurePhase || futurePhase.proration_behavior !== 'none') throw new Error('stripe_schedule_future_phase_unverified')

    const metadata = phaseMetadata(futurePhase)
    if (metadata.smart_crm_last_change_request_id !== requestId
      || metadata.smart_crm_requested_plan !== targetPlan.code
      || metadata.smart_crm_requested_cycle !== targetCycle) {
      throw new Error('stripe_schedule_metadata_unverified')
    }

    const effectiveAt = new Date(period.end * 1000).toISOString()
    const finalize = await admin.rpc('finalize_scheduled_billing_change_request', {
      p_request_id: requestId,
      p_stripe_subscription_schedule_id: scheduled.id,
      p_effective_at: effectiveAt,
    })
    if (finalize.error) throw new Error(`billing_change_request_schedule_finalize_failed:${finalize.error.code || 'unknown'}`)

    const finalStatus = String(finalize.data)
    if (finalStatus !== 'scheduled' && finalStatus !== 'applied') {
      throw new Error('billing_change_request_schedule_finalize_unverified')
    }

    return json(req, finalStatus === 'applied' ? 200 : 202, {
      status: finalStatus,
      plan_code: targetPlan.code,
      billing_cycle: targetCycle,
      effective_at: effectiveAt,
      request_id: requestId,
      mode: 'test',
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 120) : 'stripe_schedule_change_failed'
    let cleanupFailed = false

    if (createdScheduleId) {
      try {
        await stripe.subscriptionSchedules.release(
          createdScheduleId,
          { preserve_cancel_date: false },
          { idempotencyKey: `schedule-cleanup:${workspaceId}:${idempotencyKey}` },
        )
      } catch (cleanupError) {
        cleanupFailed = true
        console.error('Stripe schedule cleanup failed', {
          reason: cleanupError instanceof Error ? cleanupError.message.slice(0, 120) : 'unknown',
        })
      }
    }

    await updateRequest(admin, requestId, {
      status: 'failed',
      stripe_subscription_schedule_id: createdScheduleId,
      error_code: cleanupFailed ? `cleanup_failed:${reason}`.slice(0, 120) : reason,
    })

    console.error('Stripe scheduled billing change failed', { reason, cleanupFailed })
    return json(req, 502, {
      error: cleanupFailed
        ? 'Stripe test scheduling needs administrator reconciliation before another plan change.'
        : 'Stripe test scheduling could not be completed safely. The current plan remains unchanged.',
      request_id: requestId,
    })
  }
})