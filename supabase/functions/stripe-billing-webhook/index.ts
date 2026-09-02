import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@22.6.0'

const MAX_BODY_BYTES = 512 * 1024
const STRIPE_PLAN_CODES = new Set(['starter', 'pro'])
const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
])

type AdminClient = ReturnType<typeof createClient<any>>

type PlanRow = {
  id: string
  code: string
  is_active: boolean
  currency_code: string
  price_monthly: number | string | null
  price_annual: number | string | null
  stripe_product_id: string | null
  stripe_price_id_monthly: string | null
  stripe_price_id_annual: string | null
}

type SubscriptionState = {
  workspace_id: string
  plan_id: string
  billing_provider: 'none' | 'manual' | 'stripe'
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
}

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function validBillingRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^brq_[a-f0-9]{32}$/.test(value)
}

function loadStripeTestConfig() {
  const mode = Deno.env.get('STRIPE_BILLING_MODE') || ''
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY') || ''
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || ''

  if (mode !== 'test') return { error: 'Stripe billing webhook is not enabled in test mode' as const }
  if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('rk_test_')) {
    return { error: 'Stripe test credentials are not configured' as const }
  }
  if (!webhookSecret.startsWith('whsec_')) {
    return { error: 'Stripe webhook signing secret is not configured' as const }
  }

  return { secretKey, webhookSecret }
}

function objectId(value: unknown) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id
  return null
}

function metadataObject(value: unknown) {
  if (!value || typeof value !== 'object') return {} as Record<string, string>
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') result[key] = item
  }
  return result
}

function unixToIso(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return new Date(value * 1000).toISOString()
}

function mapSubscriptionStatus(status: string) {
  if (['trialing', 'active', 'past_due', 'canceled', 'incomplete', 'paused'].includes(status)) return status
  if (status === 'unpaid') return 'past_due'
  if (status === 'incomplete_expired') return 'canceled'
  return 'incomplete'
}

function subscriptionPrice(subscription: Stripe.Subscription) {
  const items = subscription.items?.data || []
  if (items.length !== 1) throw new Error('stripe_subscription_item_count_invalid')
  if (items[0].quantity !== 1) throw new Error('stripe_subscription_quantity_invalid')
  return items[0].price
}

async function findWorkspaceByStripeIdentity(
  admin: AdminClient,
  customerId: string,
  subscriptionId: string,
) {
  const { data: bySubscription, error: subError } = await admin
    .from('subscriptions')
    .select('workspace_id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle()

  if (subError) throw new Error(`subscription_identity_lookup_failed:${subError.code || 'unknown'}`)
  if (bySubscription?.workspace_id) return String(bySubscription.workspace_id)

  const { data: byCustomer, error: customerError } = await admin
    .from('subscriptions')
    .select('workspace_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()

  if (customerError) throw new Error(`customer_identity_lookup_failed:${customerError.code || 'unknown'}`)
  return byCustomer?.workspace_id ? String(byCustomer.workspace_id) : null
}

async function assertStripeIdentityNotCrossTenant(
  admin: AdminClient,
  workspaceId: string,
  customerId: string,
  subscriptionId: string,
) {
  const { data: customerOwner, error: customerError } = await admin
    .from('subscriptions')
    .select('workspace_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()

  if (customerError) throw new Error(`customer_collision_check_failed:${customerError.code || 'unknown'}`)
  if (customerOwner?.workspace_id && String(customerOwner.workspace_id) !== workspaceId) {
    throw new Error('stripe_customer_cross_workspace_collision')
  }

  const { data: subscriptionOwner, error: subscriptionError } = await admin
    .from('subscriptions')
    .select('workspace_id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle()

  if (subscriptionError) throw new Error(`subscription_collision_check_failed:${subscriptionError.code || 'unknown'}`)
  if (subscriptionOwner?.workspace_id && String(subscriptionOwner.workspace_id) !== workspaceId) {
    throw new Error('stripe_subscription_cross_workspace_collision')
  }
}

async function resolvePlanFromPrice(admin: AdminClient, price: Stripe.Price) {
  const { data, error } = await admin
    .from('plans')
    .select('id, code, is_active, currency_code, price_monthly, price_annual, stripe_product_id, stripe_price_id_monthly, stripe_price_id_annual')
    .eq('is_active', true)

  if (error) throw new Error(`plan_mapping_lookup_failed:${error.code || 'unknown'}`)

  const matches: Array<{ plan: PlanRow; billingCycle: 'monthly' | 'annual' }> = []
  for (const row of (data || []) as PlanRow[]) {
    if (!STRIPE_PLAN_CODES.has(row.code)) continue
    if (row.stripe_price_id_monthly === price.id) matches.push({ plan: row, billingCycle: 'monthly' })
    if (row.stripe_price_id_annual === price.id) matches.push({ plan: row, billingCycle: 'annual' })
  }

  if (matches.length !== 1) throw new Error('stripe_price_mapping_missing_or_ambiguous')
  const mapping = matches[0]

  if (!mapping.plan.stripe_product_id?.startsWith('prod_')) throw new Error('stripe_product_mapping_missing')
  if (objectId(price.product) !== mapping.plan.stripe_product_id) throw new Error('stripe_product_mapping_mismatch')

  const currency = mapping.plan.currency_code.trim().toUpperCase()
  if (currency !== 'USD') throw new Error('unsupported_billing_currency')
  if (price.currency.toUpperCase() !== currency) throw new Error('stripe_price_currency_mismatch')

  const configuredMajorAmount = Number(
    mapping.billingCycle === 'annual' ? mapping.plan.price_annual : mapping.plan.price_monthly,
  )
  if (!Number.isFinite(configuredMajorAmount) || configuredMajorAmount < 0) {
    throw new Error('local_plan_amount_invalid')
  }
  if (price.unit_amount !== Math.round(configuredMajorAmount * 100)) {
    throw new Error('stripe_price_amount_mismatch')
  }

  const expectedInterval = mapping.billingCycle === 'annual' ? 'year' : 'month'
  if (!price.recurring || price.recurring.interval !== expectedInterval) {
    throw new Error('stripe_price_interval_mismatch')
  }
  if (price.recurring.interval_count !== 1) throw new Error('stripe_price_interval_count_mismatch')
  if (price.recurring.usage_type !== 'licensed') throw new Error('stripe_price_usage_type_mismatch')

  return mapping
}

async function loadCurrentSubscription(admin: AdminClient, workspaceId: string) {
  const { data, error } = await admin
    .from('subscriptions')
    .select('workspace_id, plan_id, billing_provider, stripe_customer_id, stripe_subscription_id')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (error) throw new Error(`workspace_subscription_lookup_failed:${error.code || 'unknown'}`)
  if (!data) throw new Error('workspace_subscription_missing')
  return data as SubscriptionState
}

async function assertTrustedInitialCheckout(
  admin: AdminClient,
  workspaceId: string,
  metadata: Record<string, string>,
  mapping: { plan: PlanRow; billingCycle: 'monthly' | 'annual' },
) {
  if (!validBillingRequestId(metadata.billing_request_id)) {
    throw new Error('stripe_checkout_request_id_missing')
  }
  if (!validUuid(metadata.requested_by)) throw new Error('stripe_checkout_requester_missing')
  if (metadata.plan_code !== mapping.plan.code) throw new Error('stripe_subscription_plan_metadata_mismatch')
  if (metadata.billing_cycle !== mapping.billingCycle) throw new Error('stripe_subscription_cycle_metadata_mismatch')

  const { data: requests, error } = await admin
    .from('billing_events')
    .select('payload')
    .eq('workspace_id', workspaceId)
    .eq('event_type', 'stripe_checkout.request_created')
    .eq('billing_provider', 'none')
    .contains('payload', { billing_request_id: metadata.billing_request_id })
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) throw new Error(`stripe_checkout_request_lookup_failed:${error.code || 'unknown'}`)
  const requestPayload = metadataObject(requests?.[0]?.payload)
  if (!requestPayload.billing_request_id) throw new Error('stripe_checkout_request_not_authorized')
  if (requestPayload.plan_code !== metadata.plan_code) throw new Error('stripe_checkout_request_plan_mismatch')
  if (requestPayload.billing_cycle !== metadata.billing_cycle) throw new Error('stripe_checkout_request_cycle_mismatch')
  if (requestPayload.requested_by !== metadata.requested_by) throw new Error('stripe_checkout_requester_mismatch')
}

async function syncStripeSubscription(
  admin: AdminClient,
  subscription: Stripe.Subscription,
  fallbackMetadata: Record<string, string> = {},
) {
  const rawSubscription = subscription as unknown as Record<string, unknown>
  const customerId = objectId(subscription.customer)
  const subscriptionId = subscription.id
  if (!customerId || !subscriptionId) throw new Error('stripe_subscription_identity_missing')

  const metadata = { ...fallbackMetadata, ...metadataObject(subscription.metadata) }
  let workspaceId = validUuid(metadata.workspace_id) ? metadata.workspace_id : null
  if (!workspaceId) workspaceId = await findWorkspaceByStripeIdentity(admin, customerId, subscriptionId)
  if (!workspaceId) throw new Error('stripe_subscription_workspace_unresolved')

  await assertStripeIdentityNotCrossTenant(admin, workspaceId, customerId, subscriptionId)

  const price = subscriptionPrice(subscription)
  const mapping = await resolvePlanFromPrice(admin, price)

  const current = await loadCurrentSubscription(admin, workspaceId)
  if (current.billing_provider === 'manual') {
    throw new Error('manual_subscription_requires_explicit_conversion')
  }

  // The first none -> Stripe transition must prove that Smart CRM created and
  // audited the authorized Checkout request. Stripe-side metadata alone is not
  // enough to grant a workspace paid entitlement.
  if (current.billing_provider === 'none') {
    await assertTrustedInitialCheckout(admin, workspaceId, metadata, mapping)
  }

  // Checkout metadata is an initial tenant-routing assertion, not permanent
  // plan authority. Once Stripe owns the subscription, the current Stripe
  // Price is authoritative so legitimate Portal upgrades/downgrades are not
  // blocked by stale metadata from the original Checkout Session.
  if (current.billing_provider === 'stripe') {
    if (current.stripe_customer_id && current.stripe_customer_id !== customerId) {
      throw new Error('stripe_customer_identity_mismatch')
    }
    if (current.stripe_subscription_id && current.stripe_subscription_id !== subscriptionId) {
      throw new Error('stripe_subscription_identity_mismatch')
    }
  }

  const status = mapSubscriptionStatus(subscription.status)
  const update = {
    plan_id: mapping.plan.id,
    status,
    billing_cycle: mapping.billingCycle,
    billing_provider: 'stripe',
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    trial_ends_at: unixToIso(rawSubscription.trial_end),
    current_period_start: unixToIso(rawSubscription.current_period_start),
    current_period_end: unixToIso(rawSubscription.current_period_end),
    cancel_at_period_end: subscription.cancel_at_period_end === true,
    canceled_at: unixToIso(rawSubscription.canceled_at),
  }

  const { error: updateError } = await admin
    .from('subscriptions')
    .update(update)
    .eq('workspace_id', workspaceId)

  if (updateError) throw new Error(`stripe_subscription_sync_failed:${updateError.code || 'unknown'}`)
  return workspaceId
}

function invoiceSubscriptionId(invoice: Stripe.Invoice) {
  const raw = invoice as unknown as Record<string, unknown>
  const legacy = objectId(raw.subscription)
  if (legacy) return legacy

  const parent = raw.parent
  if (parent && typeof parent === 'object') {
    const details = (parent as Record<string, unknown>).subscription_details
    if (details && typeof details === 'object') {
      return objectId((details as Record<string, unknown>).subscription)
    }
  }
  return null
}

async function handleEvent(admin: AdminClient, stripe: Stripe, event: Stripe.Event) {
  if (!HANDLED_EVENTS.has(event.type)) return null

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session
    if (session.mode !== 'subscription') return null
    const subscriptionId = objectId(session.subscription)
    if (!subscriptionId) throw new Error('checkout_subscription_identity_missing')
    const subscription = await stripe.subscriptions.retrieve(subscriptionId)
    return await syncStripeSubscription(admin, subscription, metadataObject(session.metadata))
  }

  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const eventSubscription = event.data.object as Stripe.Subscription
    // Re-fetch current Stripe state so a delayed created/updated event cannot
    // roll local billing backward after a newer lifecycle event already won.
    const currentSubscription = await stripe.subscriptions.retrieve(eventSubscription.id)
    return await syncStripeSubscription(admin, currentSubscription)
  }

  if (event.type === 'customer.subscription.deleted') {
    // The deletion event itself carries the terminal state. Avoid depending on
    // post-deletion retrieval behavior while still preserving identity checks.
    return await syncStripeSubscription(admin, event.data.object as Stripe.Subscription)
  }

  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice
    const subscriptionId = invoiceSubscriptionId(invoice)
    if (!subscriptionId) return null
    const subscription = await stripe.subscriptions.retrieve(subscriptionId)
    return await syncStripeSubscription(admin, subscription)
  }

  return null
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'stripe_webhook_processing_failed'
  return message.slice(0, 500)
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const contentLength = Number(req.headers.get('content-length') || '0')
  if (contentLength > MAX_BODY_BYTES) return json(413, { error: 'Request payload is too large' })

  const stripeConfig = loadStripeTestConfig()
  if ('error' in stripeConfig) return json(503, { error: stripeConfig.error })

  const signature = req.headers.get('Stripe-Signature') || ''
  if (!signature) return json(400, { error: 'Missing Stripe signature' })

  const rawBody = await req.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json(413, { error: 'Request payload is too large' })
  }

  const stripe = new Stripe(stripeConfig.secretKey)
  const cryptoProvider = Stripe.createSubtleCryptoProvider()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      stripeConfig.webhookSecret,
      undefined,
      cryptoProvider,
    )
  } catch {
    console.warn('Stripe webhook signature verification failed')
    return json(400, { error: 'Invalid Stripe signature' })
  }

  // P0-3 is deliberately test-only. A validly signed live event is still
  // rejected so accidental live configuration cannot mutate local billing.
  if (event.livemode) return json(403, { error: 'Live Stripe events are disabled in Billing P0-3' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: 'Server database access is not configured' })

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const object = event.data.object as unknown as Record<string, unknown>
  const auditPayload = {
    event_id: event.id,
    event_type: event.type,
    livemode: event.livemode,
    created: event.created,
    object_type: typeof object.object === 'string' ? object.object : null,
    object_id: typeof object.id === 'string' ? object.id : null,
  }

  const { error: insertError } = await admin.from('billing_events').insert({
    stripe_event_id: event.id,
    event_type: event.type,
    billing_provider: 'stripe',
    payload: auditPayload,
    processed_at: null,
    error_message: null,
  })

  if (insertError && insertError.code !== '23505') {
    console.error('Stripe billing event ledger insert failed', { code: insertError.code })
    return json(503, { error: 'Billing event ledger is temporarily unavailable' })
  }

  if (insertError?.code === '23505') {
    const { data: existing, error: existingError } = await admin
      .from('billing_events')
      .select('processed_at')
      .eq('stripe_event_id', event.id)
      .maybeSingle()

    if (existingError) return json(503, { error: 'Billing event replay state is temporarily unavailable' })
    if (existing?.processed_at) return json(200, { received: true, duplicate: true, mode: 'test' })
  }

  try {
    const workspaceId = await handleEvent(admin, stripe, event)
    const { error: processedError } = await admin
      .from('billing_events')
      .update({
        workspace_id: workspaceId,
        processed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('stripe_event_id', event.id)

    if (processedError) throw new Error(`billing_event_finalize_failed:${processedError.code || 'unknown'}`)

    return json(200, {
      received: true,
      handled: HANDLED_EVENTS.has(event.type),
      mode: 'test',
    })
  } catch (error) {
    const safeMessage = safeErrorMessage(error)
    await admin
      .from('billing_events')
      .update({ processed_at: null, error_message: safeMessage })
      .eq('stripe_event_id', event.id)

    console.error('Stripe webhook processing failed', { eventType: event.type, reason: safeMessage })
    return json(500, { error: 'Stripe billing event could not be synchronized' })
  }
})
