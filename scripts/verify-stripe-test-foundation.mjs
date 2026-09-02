import fs from 'node:fs'

const paths = {
  checkout: 'supabase/functions/crm-billing-checkout/index.ts',
  portal: 'supabase/functions/crm-billing-portal/index.ts',
  changePlan: 'supabase/functions/crm-billing-change-plan/index.ts',
  webhook: 'supabase/functions/stripe-billing-webhook/index.ts',
  changeLedgerMigration: 'supabase/migrations/20260902115500_add_billing_change_requests.sql',
  config: 'supabase/config.toml',
}

const source = Object.fromEntries(
  Object.entries(paths).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')]),
)

function requireContains(name, text, needle) {
  if (!text.includes(needle)) throw new Error(`${name} is missing required safety marker: ${needle}`)
}

function requireNotContains(name, text, needle) {
  if (text.includes(needle)) throw new Error(`${name} contains forbidden marker: ${needle}`)
}

for (const name of ['checkout', 'portal', 'changePlan', 'webhook']) {
  requireContains(name, source[name], "npm:stripe@22.6.0")
  requireContains(name, source[name], "mode !== 'test'")
  requireContains(name, source[name], "secretKey.startsWith('sk_test_')")
  requireNotContains(name, source[name], 'sk_live_')
  requireNotContains(name, source[name], 'rk_live_')
}

requireContains('checkout', source.checkout, "new Set(['starter', 'pro'])")
requireContains('checkout', source.checkout, "new Set(['monthly', 'annual'])")
requireContains('checkout', source.checkout, 'stripe_product_id')
requireContains('checkout', source.checkout, 'stripe_price_id_monthly')
requireContains('checkout', source.checkout, 'stripe_price_id_annual')
requireContains('checkout', source.checkout, ".eq('is_active', true)")
requireContains('checkout', source.checkout, ".eq('is_public', true)")
requireContains('checkout', source.checkout, "['owner', 'admin']")
requireContains('checkout', source.checkout, "subscription.billing_provider === 'manual'")
requireContains('checkout', source.checkout, "subscription.billing_provider === 'stripe'")
requireContains('checkout', source.checkout, "subscription.billing_provider !== 'none'")
requireContains('checkout', source.checkout, "currentPlan?.code !== 'free'")
requireContains('checkout', source.checkout, 'stripe.prices.retrieve(priceId)')
requireContains('checkout', source.checkout, 'validateStripePrice')
requireContains('checkout', source.checkout, 'price.unit_amount')
requireContains('checkout', source.checkout, 'price.recurring.interval')
requireContains('checkout', source.checkout, 'stripe_product_mapping_mismatch')
requireContains('checkout', source.checkout, 'stableBillingRequestId')
requireContains('checkout', source.checkout, 'billing_request_id: billingRequestId')
requireContains('checkout', source.checkout, "event_type: 'stripe_checkout.request_created'")
requireContains('checkout', source.checkout, "billing_provider: 'none'")
requireContains('checkout', source.checkout, 'checkout_session_id: session.id')
requireContains('checkout', source.checkout, "mode: 'subscription'")
requireContains('checkout', source.checkout, 'subscription_data: { metadata }')
requireContains('checkout', source.checkout, 'idempotencyKey: `checkout:${workspaceId}:${idempotencyKey}`')
requireContains('checkout', source.checkout, 'success_url: `${PROD_ORIGIN}/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`')
requireNotContains('checkout', source.checkout, 'payload.price_id')
requireNotContains('checkout', source.checkout, 'payload.stripe_price_id')

requireContains('portal', source.portal, "['owner', 'admin']")
requireContains('portal', source.portal, "subscription.billing_provider !== 'stripe'")
requireContains('portal', source.portal, 'subscription.stripe_customer_id')
requireContains('portal', source.portal, 'return_url: `${PROD_ORIGIN}/settings?billing=portal-return`')

requireContains('changePlan', source.changePlan, "targetPlanCode !== 'pro'")
requireContains('changePlan', source.changePlan, "['owner', 'admin']")
requireContains('changePlan', source.changePlan, "localSubscription.billing_provider !== 'stripe'")
requireContains('changePlan', source.changePlan, "localSubscription.status !== 'active'")
requireContains('changePlan', source.changePlan, 'targetCycle !== currentCycle')
requireContains('changePlan', source.changePlan, "currentPlanData.code !== 'starter'")
requireContains('changePlan', source.changePlan, 'stableChangeRequestId')
requireContains('changePlan', source.changePlan, ".from('billing_change_requests')")
requireContains('changePlan', source.changePlan, "status: 'processing'")
requireContains('changePlan', source.changePlan, 'stripeScheduleId(stripeSubscription)')
requireContains('changePlan', source.changePlan, 'rawSubscription.pending_update')
requireContains('changePlan', source.changePlan, "payment_behavior: 'pending_if_incomplete'")
requireContains('changePlan', source.changePlan, "proration_behavior: 'always_invoice'")
requireContains('changePlan', source.changePlan, 'stripe.invoices.voidInvoice(')
requireContains('changePlan', source.changePlan, 'upgrade_payment_rollback_unverified')
requireContains('changePlan', source.changePlan, 'idempotencyKey: `upgrade:${workspaceId}:${idempotencyKey}`')
requireContains('changePlan', source.changePlan, 'validateStripePrice')
requireNotContains('changePlan', source.changePlan, 'payload.price_id')
requireNotContains('changePlan', source.changePlan, 'payload.stripe_price_id')
requireNotContains('changePlan', source.changePlan, 'payload.stripe_subscription_id')
requireNotContains('changePlan', source.changePlan, 'payload.stripe_customer_id')

requireContains('changeLedgerMigration', source.changeLedgerMigration, 'create table if not exists public.billing_change_requests')
requireContains('changeLedgerMigration', source.changeLedgerMigration, "where status in ('processing', 'scheduled')")
requireContains('changeLedgerMigration', source.changeLedgerMigration, 'alter table public.billing_change_requests enable row level security')
requireContains('changeLedgerMigration', source.changeLedgerMigration, 'revoke all on table public.billing_change_requests from authenticated')
requireContains('changeLedgerMigration', source.changeLedgerMigration, 'grant select, insert, update, delete on table public.billing_change_requests to service_role')

requireContains('webhook', source.webhook, "req.headers.get('Stripe-Signature')")
requireContains('webhook', source.webhook, 'const rawBody = await req.text()')
requireContains('webhook', source.webhook, 'stripe.webhooks.constructEventAsync(')
requireContains('webhook', source.webhook, 'Stripe.createSubtleCryptoProvider()')
requireContains('webhook', source.webhook, 'if (event.livemode)')
requireContains('webhook', source.webhook, "insertError.code !== '23505'")
requireContains('webhook', source.webhook, 'if (existing?.processed_at)')
requireContains('webhook', source.webhook, 'assertStripeIdentityNotCrossTenant')
requireContains('webhook', source.webhook, 'assertTrustedInitialCheckout')
requireContains('webhook', source.webhook, "event_type', 'stripe_checkout.request_created'")
requireContains('webhook', source.webhook, "current.billing_provider === 'manual'")
requireContains('webhook', source.webhook, "current.billing_provider === 'none'")
requireContains('webhook', source.webhook, 'stripe_product_id')
requireContains('webhook', source.webhook, 'price.unit_amount')
requireContains('webhook', source.webhook, 'price.recurring.interval')
requireContains('webhook', source.webhook, 'stripe_product_mapping_mismatch')
requireContains('webhook', source.webhook, 'items.length !== 1')
requireContains('webhook', source.webhook, 'items[0].quantity !== 1')
requireContains('webhook', source.webhook, 'subscriptionPeriod')
requireContains('webhook', source.webhook, 'item.current_period_start ?? rawSubscription.current_period_start')
requireContains('webhook', source.webhook, 'item.current_period_end ?? rawSubscription.current_period_end')
requireContains('webhook', source.webhook, 'const period = subscriptionPeriod(subscription)')
requireContains('webhook', source.webhook, 'subscriptionCancelsAtPeriodEnd')
requireContains('webhook', source.webhook, 'const cancelAt = rawSubscription.cancel_at')
requireContains('webhook', source.webhook, 'cancelAt === periodEnd')
requireContains('webhook', source.webhook, 'cancel_at_period_end: subscriptionCancelsAtPeriodEnd(subscription)')
requireContains('webhook', source.webhook, 'stripe.subscriptions.retrieve(eventSubscription.id)')
requireContains('webhook', source.webhook, 'payload: auditPayload')
requireNotContains('webhook', source.webhook, 'payload: event')
requireNotContains('webhook', source.webhook, 'payload: event.data.object')

requireContains('config', source.config, '[functions.crm-billing-checkout]')
requireContains('config', source.config, '[functions.crm-billing-portal]')
requireContains('config', source.config, '[functions.crm-billing-change-plan]')
requireContains('config', source.config, '[functions.stripe-billing-webhook]')
requireContains('config', source.config, '[functions.crm-outbound-email]')

const changePlanConfig = source.config.match(/\[functions\.crm-billing-change-plan\][\s\S]*?(?=\n\[|$)/)?.[0] || ''
const webhookConfig = source.config.match(/\[functions\.stripe-billing-webhook\][\s\S]*?(?=\n\[|$)/)?.[0] || ''
const outboundConfig = source.config.match(/\[functions\.crm-outbound-email\][\s\S]*?(?=\n\[|$)/)?.[0] || ''
if (!/verify_jwt\s*=\s*true/.test(changePlanConfig)) throw new Error('Billing plan change function must keep verify_jwt=true')
if (!/verify_jwt\s*=\s*false/.test(webhookConfig)) throw new Error('Stripe webhook must keep verify_jwt=false')
if (!/verify_jwt\s*=\s*false/.test(outboundConfig)) throw new Error('Existing outbound gateway must keep verify_jwt=false')

console.log('Stripe test-mode foundation source safety checks PASS')
