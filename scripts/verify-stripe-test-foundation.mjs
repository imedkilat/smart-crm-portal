import fs from 'node:fs'

const paths = {
  checkout: 'supabase/functions/crm-billing-checkout/index.ts',
  portal: 'supabase/functions/crm-billing-portal/index.ts',
  webhook: 'supabase/functions/stripe-billing-webhook/index.ts',
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

for (const name of ['checkout', 'portal', 'webhook']) {
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
requireContains('webhook', source.webhook, 'stripe.subscriptions.retrieve(eventSubscription.id)')
requireContains('webhook', source.webhook, 'payload: auditPayload')
requireNotContains('webhook', source.webhook, 'payload: event')
requireNotContains('webhook', source.webhook, 'payload: event.data.object')

requireContains('config', source.config, '[functions.crm-billing-checkout]')
requireContains('config', source.config, '[functions.crm-billing-portal]')
requireContains('config', source.config, '[functions.stripe-billing-webhook]')
requireContains('config', source.config, '[functions.crm-outbound-email]')

const webhookConfig = source.config.match(/\[functions\.stripe-billing-webhook\][\s\S]*?(?=\n\[|$)/)?.[0] || ''
const outboundConfig = source.config.match(/\[functions\.crm-outbound-email\][\s\S]*?(?=\n\[|$)/)?.[0] || ''
if (!/verify_jwt\s*=\s*false/.test(webhookConfig)) throw new Error('Stripe webhook must keep verify_jwt=false')
if (!/verify_jwt\s*=\s*false/.test(outboundConfig)) throw new Error('Existing outbound gateway must keep verify_jwt=false')

console.log('Stripe test-mode foundation source safety checks PASS')
