import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function requireText(source, marker, description) {
  if (!source.includes(marker)) {
    throw new Error(`Missing ${description}: ${marker}`)
  }
}

const fn = read('supabase/functions/crm-billing-schedule-change/index.ts')
const migration = read('supabase/migrations/20260902142500_add_scheduled_billing_change_guardrails.sql')
const config = read('supabase/config.toml')
const workflow = read('.github/workflows/billing-stripe-foundation.yml')

requireText(fn, "mode !== 'test'", 'test-mode guard')
requireText(fn, "secretKey.startsWith('sk_test_')", 'test secret-key guard')
requireText(fn, "secretKey.startsWith('rk_test_')", 'restricted test-key guard')
requireText(fn, "if (stripeSubscription.livemode)", 'live subscription rejection')
requireText(fn, "stripe.subscriptionSchedules.create", 'subscription schedule creation')
requireText(fn, "{ from_subscription: stripeSubscription.id }", 'existing subscription schedule migration')
requireText(fn, "stripe.subscriptionSchedules.update", 'subscription schedule update')
requireText(fn, "end_behavior: 'release'", 'release end behavior')
requireText(fn, "proration_behavior: 'none'", 'no-proration schedule behavior')
requireText(fn, "billing_cycle_anchor: 'phase_start'", 'renewal phase billing anchor')
requireText(fn, "stripe.subscriptionSchedules.release", 'safe schedule release')
requireText(fn, "reserve_scheduled_billing_change_request", 'atomic scheduled request reservation')
requireText(fn, "stripe_subscription_schedule_id", 'schedule identity persistence')
requireText(fn, "Same-cycle Starter to Pro upgrades use the immediate prorated upgrade endpoint", 'immediate-upgrade policy boundary')
requireText(fn, "discounted_subscription_requires_admin_review", 'discounted subscription safety guard')
requireText(fn, "taxed_subscription_requires_admin_review", 'taxed subscription safety guard')
requireText(fn, "automatic_tax_subscription_requires_admin_review", 'automatic tax safety guard')
requireText(fn, "Target plan seat limit exceeded", 'target seat-limit handling')

requireText(migration, 'pg_advisory_xact_lock', 'workspace concurrency lock')
requireText(migration, "bcr.status in ('processing', 'scheduled')", 'future seat-cap enforcement during reservation and schedule')
requireText(migration, 'reserve_scheduled_billing_change_request', 'service-role reservation RPC')
requireText(migration, 'trg_reconcile_scheduled_billing_change', 'scheduled request reconciliation trigger')
requireText(migration, "bcr.status = 'scheduled'", 'scheduled-only reconciliation')
requireText(migration, 'to_billing_cycle = new.billing_cycle', 'cycle reconciliation guard')
requireText(migration, 'from authenticated;', 'browser execution revocation')
requireText(migration, 'to service_role;', 'service-role execution grant')

requireText(config, '[functions.crm-billing-schedule-change]', 'schedule function config block')
requireText(config, '[functions.crm-billing-schedule-change]\nverify_jwt = true', 'schedule function JWT boundary')

requireText(workflow, "supabase/functions/crm-billing-change-plan/**", 'immediate plan-change CI path')
requireText(workflow, "supabase/functions/crm-billing-schedule-change/**", 'scheduled plan-change CI path')
requireText(workflow, 'deno check --node-modules-dir=auto supabase/functions/crm-billing-change-plan/index.ts', 'immediate plan-change Deno type-check')
requireText(workflow, 'deno check --node-modules-dir=auto supabase/functions/crm-billing-schedule-change/index.ts', 'scheduled plan-change Deno type-check')

console.log('Stripe scheduled billing change safety contract verified.')
