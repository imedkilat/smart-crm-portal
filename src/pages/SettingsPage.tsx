import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import WorkspaceBrandingPanel from '../components/WorkspaceBrandingPanel'
import MessageTemplatesPanel from '../components/MessageTemplatesPanel'
import SubscriberProvisioningPanel from '../components/SubscriberProvisioningPanel'
import ArchivePage from './ArchivePage'

const LEAD_WEBHOOK = import.meta.env.VITE_N8N_LEAD_WEBHOOK_URL || 'https://tolakautomations.app.n8n.cloud/webhook/799b1d66-0a5f-44b0-8f43-600ea4775979'
const STATUS_WEBHOOK = import.meta.env.VITE_N8N_STATUS_WEBHOOK_URL || 'https://tolakautomations.app.n8n.cloud/webhook/smart-crm-status-route'

type Lead = Database['public']['Tables']['leads']['Row']

type Props = {
  onOpenRunLog: () => void
  onLeadRestored?: (lead: Lead) => void
}

function endpointLabel(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}${parsed.pathname}`
  } catch {
    return 'Configured endpoint'
  }
}

export default function SettingsPage({ onOpenRunLog, onLeadRestored }: Props) {
  const [checking, setChecking] = useState(true)
  const [databaseHealthy, setDatabaseHealthy] = useState(false)
  const [activeLeadCount, setActiveLeadCount] = useState<number | null>(null)
  const [archivedLeadCount, setArchivedLeadCount] = useState<number | null>(null)
  const [routingEventCount, setRoutingEventCount] = useState<number | null>(null)
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null)
  const [ownerRole, setOwnerRole] = useState<string | null>(null)
  const [planName, setPlanName] = useState<string | null>(null)
  const [planCode, setPlanCode] = useState<string | null>(null)
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null)
  const [billingCycle, setBillingCycle] = useState<string | null>(null)
  const [deploymentType, setDeploymentType] = useState<string | null>(null)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const [showArchive, setShowArchive] = useState(false)

  const checkHealth = useCallback(async () => {
    if (!supabase) {
      setDatabaseHealthy(false)
      setChecking(false)
      return
    }

    setChecking(true)
    const [leadResult, archiveResult, eventResult, userResult] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).is('archived_at', null),
      supabase.from('leads').select('id', { count: 'exact', head: true }).not('archived_at', 'is', null),
      supabase.from('lead_routing_history').select('id', { count: 'exact', head: true }),
      supabase.auth.getUser(),
    ])

    const user = userResult.data.user
    let membershipRole: string | null = null
    let workspaceId: string | null = null
    if (user) {
      const { data: membership } = await supabase
        .from('workspace_members')
        .select('role, workspace_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      membershipRole = membership?.role || null
      workspaceId = membership?.workspace_id || null
    }

    let nextPlanName: string | null = null
    let nextPlanCode: string | null = null
    let nextSubscriptionStatus: string | null = null
    let nextBillingCycle: string | null = null
    let nextDeploymentType: string | null = null

    if (workspaceId) {
      // Billing tables landed after the checked-in generated Database type.
      // Keep the query locally typed until the next schema type generation.
      const billingClient = supabase as unknown as SupabaseClient
      const { data: subscription } = await billingClient
        .from('subscriptions')
        .select('plan_id, status, billing_cycle, deployment_type')
        .eq('workspace_id', workspaceId)
        .maybeSingle()

      if (subscription) {
        nextSubscriptionStatus = String(subscription.status)
        nextBillingCycle = String(subscription.billing_cycle)
        nextDeploymentType = String(subscription.deployment_type)

        const { data: plan } = await billingClient
          .from('plans')
          .select('code, name')
          .eq('id', subscription.plan_id)
          .maybeSingle()
        nextPlanName = plan?.name ? String(plan.name) : null
        nextPlanCode = plan?.code ? String(plan.code) : null
      }
    }

    setDatabaseHealthy(!leadResult.error && !archiveResult.error && !eventResult.error)
    setActiveLeadCount(leadResult.count ?? null)
    setArchivedLeadCount(archiveResult.count ?? null)
    setRoutingEventCount(eventResult.count ?? null)
    setOwnerEmail(user?.email || null)
    setOwnerRole(membershipRole)
    setPlanName(nextPlanName)
    setPlanCode(nextPlanCode)
    setSubscriptionStatus(nextSubscriptionStatus)
    setBillingCycle(nextBillingCycle)
    setDeploymentType(nextDeploymentType)
    setIsPlatformAdmin(user?.app_metadata?.platform_role === 'platform_admin')
    setCheckedAt(new Date())
    setChecking(false)
  }, [])

  useEffect(() => { void checkHealth() }, [checkHealth])

  if (showArchive) {
    return (
      <ArchivePage
        onRestored={(lead) => {
          onLeadRestored?.(lead)
          void checkHealth()
        }}
        onBack={() => {
          setShowArchive(false)
          void checkHealth()
        }}
      />
    )
  }

  return (
    <>
      <section className="page-heading connected-page-heading">
        <div>
          <div className="eyebrow">WORKSPACE CONTROL</div>
          <h1>Settings</h1>
          <p>Review production connections, routing safeguards and the current automation behavior of Smart CRM.</p>
        </div>
        <button className="button secondary" type="button" onClick={() => void checkHealth()} disabled={checking}>
          {checking ? 'Checking…' : '↻ Refresh health'}
        </button>
      </section>

      <section className="settings-health-grid">
        <article className="panel settings-health-card">
          <div className="settings-card-heading"><span className={`system-dot ${databaseHealthy ? 'ok' : 'bad'}`} /><div><span className="mini-label">DATABASE</span><h2>Supabase</h2></div></div>
          <strong>{checking ? 'Checking connection…' : databaseHealthy ? 'Connected' : 'Needs attention'}</strong>
          <p>{activeLeadCount ?? '—'} active · {archivedLeadCount ?? '—'} archived · {routingEventCount ?? '—'} routing events</p>
        </article>

        <article className="panel settings-health-card">
          <div className="settings-card-heading"><span className="system-dot ok" /><div><span className="mini-label">LEAD INTAKE</span><h2>n8n production webhook</h2></div></div>
          <strong>Production endpoint configured</strong>
          <p className="endpoint-copy">{endpointLabel(LEAD_WEBHOOK)}</p>
        </article>

        <article className="panel settings-health-card">
          <div className="settings-card-heading"><span className="system-dot ok" /><div><span className="mini-label">STATUS ROUTER</span><h2>n8n production webhook</h2></div></div>
          <strong>Production endpoint configured</strong>
          <p className="endpoint-copy">{endpointLabel(STATUS_WEBHOOK)}</p>
        </article>
      </section>

      <WorkspaceBrandingPanel />
      <MessageTemplatesPanel />
      {isPlatformAdmin ? <SubscriberProvisioningPanel /> : null}

      <section className="settings-layout">
        <article className="panel settings-section-card">
          <div className="settings-section-heading">
            <div><span className="mini-label">ROUTING POLICY</span><h2>Automation behavior</h2><p>These rules describe how the CRM currently hands leads into the production routing workflow.</p></div>
            <button className="button tertiary" type="button" onClick={onOpenRunLog}>Open run log →</button>
          </div>

          <div className="automation-policy-list">
            <div className="automation-policy-row"><span className="policy-route hot">Hot</span><div><strong>Immediate follow-up path</strong><p>High-priority leads are sent to the Hot n8n branch.</p></div><span className="policy-state active">Active</span></div>
            <div className="automation-policy-row"><span className="policy-route warm">Warm</span><div><strong>Delayed nurture path</strong><p>Warm leads enter the nurture branch before follow-up.</p></div><span className="policy-state active">Active</span></div>
            <div className="automation-policy-row"><span className="policy-route cold">Cold</span><div><strong>Low-priority queue</strong><p>Cold leads are retained without outbound follow-up from the status router.</p></div><span className="policy-state active">Active</span></div>
            <div className="automation-policy-row"><span className="policy-route guard">24h</span><div><strong>Duplicate automation guard</strong><p>The same lead cannot repeat the same accepted route within the cooldown window.</p></div><span className="policy-state active">On</span></div>
            <div className="automation-policy-row"><span className="policy-route calendar">Cal</span><div><strong>Automatic calendar creation</strong><p>Meeting creation stays separate from routing until a customer confirms a schedule.</p></div><span className="policy-state off">Off</span></div>
          </div>
        </article>

        <aside className="settings-side-column">
          <article className="panel settings-section-card compact-card">
            <span className="mini-label">SUBSCRIPTION</span>
            <div className="settings-plan-heading">
              <h2>{planName || 'Plan unavailable'}</h2>
              {subscriptionStatus ? <span className={`subscription-status ${subscriptionStatus}`}>{subscriptionStatus}</span> : null}
            </div>
            <div className="owner-settings-row"><span>Entitlement</span><strong>{planCode || 'Unavailable'}</strong></div>
            <div className="owner-settings-row"><span>Billing</span><strong>{billingCycle || 'Unavailable'}</strong></div>
            <div className="owner-settings-row"><span>Deployment</span><strong>{deploymentType || 'Unavailable'}</strong></div>
            <p className="settings-note">Follow-up automation is available on Starter, Pro and White Label plans when workspace follow-up settings are enabled.</p>
          </article>

          <article className="panel settings-section-card compact-card">
            <span className="mini-label">WORKSPACE ACCESS</span>
            <h2>Workspace identity</h2>
            <div className="owner-settings-row"><span>Email</span><strong>{ownerEmail || 'Unavailable'}</strong></div>
            <div className="owner-settings-row"><span>Role</span><strong>{ownerRole || 'Authenticated member'}</strong></div>
            <div className="owner-settings-row"><span>Access model</span><strong>Workspace membership</strong></div>
          </article>

          <article className="panel settings-section-card compact-card">
            <span className="mini-label">DATA RETENTION</span>
            <h2>Archived leads</h2>
            <p className="settings-muted">{archivedLeadCount ?? '—'} records currently archived</p>
            <p className="settings-note">Archived records stay out of active metrics and automations while keeping their database and routing history intact.</p>
            <button className="button secondary settings-full-button" type="button" onClick={() => setShowArchive(true)}>Manage archive →</button>
          </article>

          <article className="panel settings-section-card compact-card">
            <span className="mini-label">SYSTEM CHECK</span>
            <h2>Latest health refresh</h2>
            <p className="settings-muted">{checkedAt ? checkedAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not checked yet'}</p>
            <p className="settings-note">Webhook cards confirm the CRM is configured to use production endpoints. External n8n workflow state is managed in n8n itself.</p>
          </article>
        </aside>
      </section>
    </>
  )
}
