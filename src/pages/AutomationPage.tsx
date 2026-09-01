import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import LeadProfileDrawer from '../components/LeadProfileDrawer'

type Lead = Database['public']['Tables']['leads']['Row']
type RoutingEvent = Database['public']['Tables']['lead_routing_history']['Row']
type AiInteraction = Database['public']['Tables']['ai_interactions']['Row']
type WeeklySummary = Database['public']['Tables']['weekly_summary']['Row']
type ResultFilter = 'all' | 'accepted' | 'suppressed_24h' | 'failed'
type RouteFilter = 'all' | 'Hot' | 'Warm' | 'Cold'
type HealthState = 'healthy' | 'attention' | 'off' | 'waiting' | 'safe'

type AutomationRun = {
  id: string
  workspace_id: string
  automation_key: string
  automation_name: string
  source: 'n8n' | 'edge_function' | 'scheduler' | 'database' | 'system'
  trigger_type: string
  status: 'running' | 'succeeded' | 'failed' | 'suppressed' | 'skipped'
  run_ref: string | null
  correlation_key: string | null
  record_type: string | null
  record_id: string | null
  attempt_number: number
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  error_code: string | null
  error_message: string | null
  metadata: Record<string, unknown>
}

type LeadActivity = {
  id: string
  workspace_id: string
  activity_type: string
  title: string
  metadata: Record<string, unknown>
  occurred_at: string
}

type OutboundDelivery = {
  id: string
  public_id: string
  workspace_id: string
  lead_id: number
  status: string
  mode: string
  provider: string | null
  attempt_count: number
  last_attempt_at: string | null
  last_error_code: string | null
  last_error_message: string | null
  created_at: string
  updated_at: string
}

type OutboundAttempt = {
  id: string
  workspace_id: string
  delivery_id: string
  status: string
  error_code: string | null
  error_message: string | null
  attempted_at: string
}

type QuoteAlert = {
  id: string
  public_id: string
  workspace_id: string
  status: string
  alert_type: string
  channel: string
  attempt_count: number
  last_attempt_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

type ToggleSetting = {
  workspace_id: string
  enabled: boolean
  paused_until: string | null
}

type OutboundSetting = ToggleSetting & {
  mode: string
  provider: string | null
}

type Incident = {
  id: string
  automation: string
  state: HealthState
  title: string
  detail: string
  at: string
}

type HealthCard = {
  key: string
  name: string
  source: string
  state: HealthState
  status: string
  metric: string
  note: string
  lastAt: string | null
}

type Props = {
  onLeadUpdated?: (lead: Lead) => void
}

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_HEARTBEAT_MS = 8 * DAY_MS

function resultLabel(value: string) {
  if (value === 'accepted') return 'Started'
  if (value === 'suppressed_24h') return 'Suppressed'
  if (value === 'failed') return 'Failed'
  return value.replace(/_/g, ' ')
}

function resultClass(value: string) {
  if (value === 'accepted') return 'success'
  if (value === 'suppressed_24h') return 'suppressed'
  if (value === 'failed') return 'failed'
  return 'neutral'
}

function routeClass(value: string | null) {
  const normalized = (value || '').toLowerCase()
  if (normalized === 'hot') return 'hot'
  if (normalized === 'warm') return 'warm'
  return 'cold'
}

function healthLabel(value: HealthState) {
  if (value === 'healthy') return 'Healthy'
  if (value === 'attention') return 'Needs attention'
  if (value === 'safe') return 'Safe mode'
  if (value === 'off') return 'Off'
  return 'Waiting'
}

function prettySource(value: string) {
  if (value === 'edge_function') return 'Edge Function'
  if (value === 'n8n') return 'n8n'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function compactDate(value: string | null) {
  if (!value) return 'No activity yet'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Unknown time'
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function isRecent(value: string | null, windowMs = DAY_MS) {
  if (!value) return false
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && Date.now() - timestamp >= 0 && Date.now() - timestamp <= windowMs
}

function isPaused(value: string | null) {
  if (!value) return false
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp > Date.now()
}

function safeDetail(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim()
  if (!normalized) return fallback
  return normalized.length > 180 ? `${normalized.slice(0, 177)}…` : normalized
}

function followUpActivity(row: LeadActivity) {
  const text = `${row.activity_type} ${row.title} ${JSON.stringify(row.metadata || {})}`.toLowerCase()
  return text.includes('follow-up') || text.includes('follow up') || text.includes('followup')
}

function isFailureStatus(value: string) {
  return ['failed', 'bounced', 'error'].includes(value.toLowerCase())
}

export default function AutomationPage({ onLeadUpdated }: Props) {
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [runTelemetryReady, setRunTelemetryReady] = useState(true)
  const [events, setEvents] = useState<RoutingEvent[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [aiInteractions, setAiInteractions] = useState<AiInteraction[]>([])
  const [leadActivities, setLeadActivities] = useState<LeadActivity[]>([])
  const [deliveries, setDeliveries] = useState<OutboundDelivery[]>([])
  const [attempts, setAttempts] = useState<OutboundAttempt[]>([])
  const [quoteAlerts, setQuoteAlerts] = useState<QuoteAlert[]>([])
  const [weeklySummaries, setWeeklySummaries] = useState<WeeklySummary[]>([])
  const [followSettings, setFollowSettings] = useState<ToggleSetting[]>([])
  const [outboundSettings, setOutboundSettings] = useState<OutboundSetting[]>([])
  const [quoteAlertSettings, setQuoteAlertSettings] = useState<ToggleSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [routeFilter, setRouteFilter] = useState<RouteFilter>('all')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)

  const loadHealth = useCallback(async (background = false) => {
    if (!supabase) {
      setError('Supabase is not configured for this environment.')
      setLoading(false)
      return
    }

    if (background) setRefreshing(true)
    else setLoading(true)
    setError(null)

    // Newer commercial tables are intentionally kept local to this page until the generated DB type is refreshed.
    const client = supabase as any
    const [
      runsResult,
      eventsResult,
      leadsResult,
      aiResult,
      activitiesResult,
      deliveriesResult,
      attemptsResult,
      alertsResult,
      weeklyResult,
      followSettingsResult,
      outboundSettingsResult,
      alertSettingsResult,
    ] = await Promise.all([
      client.from('automation_runs').select('*').order('started_at', { ascending: false }).limit(100),
      client.from('lead_routing_history').select('*').order('changed_at', { ascending: false }).limit(100),
      client.from('leads').select('*').order('created_at', { ascending: false }),
      client.from('ai_interactions').select('*').order('created_at', { ascending: false }).limit(100),
      client.from('lead_activities').select('id,workspace_id,activity_type,title,metadata,occurred_at').order('occurred_at', { ascending: false }).limit(100),
      client.from('outbound_email_deliveries').select('id,public_id,workspace_id,lead_id,status,mode,provider,attempt_count,last_attempt_at,last_error_code,last_error_message,created_at,updated_at').order('created_at', { ascending: false }).limit(100),
      client.from('outbound_email_attempts').select('id,workspace_id,delivery_id,status,error_code,error_message,attempted_at').order('attempted_at', { ascending: false }).limit(100),
      client.from('quote_alerts').select('id,public_id,workspace_id,status,alert_type,channel,attempt_count,last_attempt_at,last_error,created_at,updated_at').order('created_at', { ascending: false }).limit(100),
      client.from('weekly_summary').select('*').order('created_at', { ascending: false }).limit(20),
      client.from('workspace_follow_up_settings').select('workspace_id,enabled,paused_until'),
      client.from('workspace_outbound_email_settings').select('workspace_id,enabled,paused_until,mode,provider'),
      client.from('workspace_quote_alert_settings').select('workspace_id,enabled,paused_until'),
    ])

    if (runsResult.error) {
      const missingRelation = runsResult.error.code === '42P01' || runsResult.error.message?.includes('automation_runs')
      if (missingRelation) {
        setRunTelemetryReady(false)
        setRuns([])
      } else {
        setError(`Could not load normalized automation runs: ${runsResult.error.message}`)
      }
    } else {
      setRunTelemetryReady(true)
      setRuns((runsResult.data || []) as AutomationRun[])
    }

    const readableResults = [eventsResult, leadsResult, aiResult, activitiesResult, deliveriesResult, attemptsResult, alertsResult, weeklyResult, followSettingsResult, outboundSettingsResult, alertSettingsResult]
    const firstError = readableResults.find((result) => result.error)?.error
    if (firstError) setError(`Could not load all health signals: ${firstError.message}`)

    if (!eventsResult.error) setEvents((eventsResult.data || []) as RoutingEvent[])
    if (!leadsResult.error) setLeads((leadsResult.data || []) as Lead[])
    if (!aiResult.error) setAiInteractions((aiResult.data || []) as AiInteraction[])
    if (!activitiesResult.error) setLeadActivities((activitiesResult.data || []) as LeadActivity[])
    if (!deliveriesResult.error) setDeliveries((deliveriesResult.data || []) as OutboundDelivery[])
    if (!attemptsResult.error) setAttempts((attemptsResult.data || []) as OutboundAttempt[])
    if (!alertsResult.error) setQuoteAlerts((alertsResult.data || []) as QuoteAlert[])
    if (!weeklyResult.error) setWeeklySummaries((weeklyResult.data || []) as WeeklySummary[])
    if (!followSettingsResult.error) setFollowSettings((followSettingsResult.data || []) as ToggleSetting[])
    if (!outboundSettingsResult.error) setOutboundSettings((outboundSettingsResult.data || []) as OutboundSetting[])
    if (!alertSettingsResult.error) setQuoteAlertSettings((alertSettingsResult.data || []) as ToggleSetting[])

    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => { void loadHealth() }, [loadHealth])

  const leadMap = useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads])

  const filtered = useMemo(() => events.filter((event) => {
    if (resultFilter !== 'all' && event.automation_result !== resultFilter) return false
    if (routeFilter !== 'all' && event.to_status !== routeFilter) return false
    return true
  }), [events, resultFilter, routeFilter])

  const routingStats = useMemo(() => ({
    total: events.length,
    started: events.filter((event) => event.automation_result === 'accepted').length,
    suppressed: events.filter((event) => event.automation_result === 'suppressed_24h').length,
    failed: events.filter((event) => event.automation_result === 'failed').length,
  }), [events])

  const incidents = useMemo<Incident[]>(() => {
    const rows: Incident[] = []

    runs.filter((run) => run.status === 'failed').forEach((run) => rows.push({
      id: `run:${run.id}`,
      automation: run.automation_name,
      state: 'attention',
      title: `${run.automation_name} failed`,
      detail: safeDetail(run.error_message || run.error_code, `${prettySource(run.source)} execution failed.`),
      at: run.finished_at || run.started_at,
    }))

    events.filter((event) => event.automation_result === 'failed').forEach((event) => rows.push({
      id: `route:${event.id}`,
      automation: 'Lead Routing',
      state: 'attention',
      title: `Routing webhook failed for ${event.to_status}`,
      detail: `Lead ${event.lead_id} changed route but the downstream automation did not start.`,
      at: event.changed_at,
    }))

    aiInteractions.filter((interaction) => interaction.status === 'failed').forEach((interaction) => rows.push({
      id: `ai:${interaction.id}`,
      automation: 'AI Brain',
      state: 'attention',
      title: 'AI Brain request failed',
      detail: safeDetail(interaction.error_message, 'The scoped AI request did not complete.'),
      at: interaction.completed_at || interaction.created_at,
    }))

    deliveries.filter((delivery) => isFailureStatus(delivery.status)).forEach((delivery) => rows.push({
      id: `delivery:${delivery.id}`,
      automation: 'Outbound Email',
      state: 'attention',
      title: `Outbound delivery ${delivery.status}`,
      detail: safeDetail(delivery.last_error_message || delivery.last_error_code, `Delivery ${delivery.public_id} needs review.`),
      at: delivery.last_attempt_at || delivery.updated_at || delivery.created_at,
    }))

    quoteAlerts.filter((alert) => isFailureStatus(alert.status)).forEach((alert) => rows.push({
      id: `alert:${alert.id}`,
      automation: 'Quote Alerts',
      state: 'attention',
      title: `Quote alert ${alert.status}`,
      detail: safeDetail(alert.last_error, `${alert.alert_type.replace(/_/g, ' ')} alert needs review.`),
      at: alert.last_attempt_at || alert.updated_at || alert.created_at,
    }))

    return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 12)
  }, [runs, events, aiInteractions, deliveries, quoteAlerts])

  const recentIncidents = useMemo(() => incidents.filter((incident) => isRecent(incident.at)), [incidents])

  const healthCards = useMemo<HealthCard[]>(() => {
    const latestRouting = events[0]
    const routingFailures = events.filter((event) => event.automation_result === 'failed' && isRecent(event.changed_at)).length
    const routingStarted = events.filter((event) => event.automation_result === 'accepted' && isRecent(event.changed_at)).length

    const latestAi = aiInteractions[0]
    const aiFailures = aiInteractions.filter((row) => row.status === 'failed' && isRecent(row.completed_at || row.created_at)).length
    const aiCompleted = aiInteractions.filter((row) => row.status === 'completed' && isRecent(row.completed_at || row.created_at)).length

    const followRows = leadActivities.filter(followUpActivity)
    const latestFollow = followRows[0]
    const followPaused = followSettings.some((setting) => isPaused(setting.paused_until))
    const followEnabled = followSettings.some((setting) => setting.enabled)

    const latestDelivery = deliveries[0]
    const outboundPaused = outboundSettings.some((setting) => isPaused(setting.paused_until))
    const outboundEnabled = outboundSettings.some((setting) => setting.enabled)
    const outboundSafe = outboundSettings.length > 0 && outboundSettings.every((setting) => !setting.enabled || setting.mode !== 'live')
    const outboundFailures = deliveries.filter((delivery) => isFailureStatus(delivery.status) && isRecent(delivery.last_attempt_at || delivery.updated_at)).length

    const latestAlert = quoteAlerts[0]
    const alertPaused = quoteAlertSettings.some((setting) => isPaused(setting.paused_until))
    const alertsEnabled = quoteAlertSettings.some((setting) => setting.enabled)
    const alertFailures = quoteAlerts.filter((alert) => isFailureStatus(alert.status) && isRecent(alert.last_attempt_at || alert.updated_at)).length

    const latestWeekly = weeklySummaries[0]
    const weeklyStale = latestWeekly ? !isRecent(latestWeekly.created_at, WEEK_HEARTBEAT_MS) : false

    return [
      {
        key: 'lead-routing',
        name: 'Lead Routing',
        source: 'Edge + n8n',
        state: routingFailures ? 'attention' : latestRouting ? 'healthy' : 'waiting',
        status: routingFailures ? `${routingFailures} failure${routingFailures === 1 ? '' : 's'} in 24h` : latestRouting ? 'No recent routing failures' : 'No routing history yet',
        metric: `${routingStarted} started / 24h`,
        note: latestRouting ? `Latest route: ${latestRouting.to_status} · ${resultLabel(latestRouting.automation_result)}` : 'Waiting for the first routing event.',
        lastAt: latestRouting?.changed_at || null,
      },
      {
        key: 'ai-brain',
        name: 'AI Brain',
        source: 'Edge + n8n + model',
        state: aiFailures ? 'attention' : latestAi ? 'healthy' : 'waiting',
        status: aiFailures ? `${aiFailures} failure${aiFailures === 1 ? '' : 's'} in 24h` : latestAi ? 'No recent AI failures' : 'No AI interactions yet',
        metric: `${aiCompleted} completed / 24h`,
        note: latestAi?.n8n_execution_id ? `Latest n8n execution: ${latestAi.n8n_execution_id}` : 'Scoped AI interactions are tracked without exposing prompt content here.',
        lastAt: latestAi ? latestAi.completed_at || latestAi.created_at : null,
      },
      {
        key: 'follow-up',
        name: 'Follow-Up Engine',
        source: 'Scheduled n8n',
        state: followPaused || !followEnabled ? 'off' : latestFollow ? 'healthy' : 'waiting',
        status: followPaused ? 'Paused by workspace' : followEnabled ? 'Enabled' : 'Disabled by workspace',
        metric: `${followRows.filter((row) => isRecent(row.occurred_at)).length} follow-up events / 24h`,
        note: latestFollow ? latestFollow.title : 'No eligible follow-up activity has been recorded recently.',
        lastAt: latestFollow?.occurred_at || null,
      },
      {
        key: 'outbound',
        name: 'Outbound Email',
        source: 'Edge + provider',
        state: outboundFailures ? 'attention' : outboundPaused || !outboundEnabled ? (outboundSafe ? 'safe' : 'off') : latestDelivery ? 'healthy' : 'waiting',
        status: outboundFailures ? `${outboundFailures} delivery failure${outboundFailures === 1 ? '' : 's'} in 24h` : outboundPaused ? 'Paused by workspace' : outboundEnabled ? 'Enabled' : outboundSafe ? 'Live sending disabled' : 'Disabled',
        metric: latestDelivery ? `${latestDelivery.attempt_count} attempt${latestDelivery.attempt_count === 1 ? '' : 's'} on latest` : '0 deliveries',
        note: latestDelivery ? `Latest ${latestDelivery.mode} delivery: ${latestDelivery.status}` : 'No outbound delivery rows yet.',
        lastAt: latestDelivery ? latestDelivery.last_attempt_at || latestDelivery.created_at : null,
      },
      {
        key: 'quote-alerts',
        name: 'Quote Alerts',
        source: 'Alert ledger',
        state: alertFailures ? 'attention' : alertPaused || !alertsEnabled ? 'off' : latestAlert ? 'healthy' : 'waiting',
        status: alertFailures ? `${alertFailures} alert failure${alertFailures === 1 ? '' : 's'} in 24h` : alertPaused ? 'Paused by workspace' : alertsEnabled ? 'Enabled' : 'Disabled by workspace',
        metric: `${quoteAlerts.filter((alert) => isRecent(alert.created_at)).length} alerts / 24h`,
        note: latestAlert ? `Latest ${latestAlert.channel} alert: ${latestAlert.status}` : 'No quote-alert delivery rows yet.',
        lastAt: latestAlert ? latestAlert.last_attempt_at || latestAlert.created_at : null,
      },
      {
        key: 'weekly-summary',
        name: 'Weekly Summary',
        source: 'Scheduled n8n',
        state: weeklyStale ? 'attention' : latestWeekly ? 'healthy' : 'waiting',
        status: weeklyStale ? 'Latest summary is older than 8 days' : latestWeekly ? 'Latest reporting heartbeat is current' : 'No summary heartbeat yet',
        metric: latestWeekly ? latestWeekly.period : 'No period',
        note: latestWeekly ? `Generated via ${latestWeekly.generation_source}` : 'Waiting for the first workspace summary.',
        lastAt: latestWeekly?.created_at || null,
      },
    ]
  }, [events, aiInteractions, leadActivities, deliveries, quoteAlerts, weeklySummaries, followSettings, outboundSettings, quoteAlertSettings])

  const latestRun = runs[0]
  const systemHealth: HealthState = recentIncidents.length > 0 ? 'attention' : 'healthy'
  const failedRuns24h = runs.filter((run) => run.status === 'failed' && isRecent(run.finished_at || run.started_at)).length
  const runningRuns = runs.filter((run) => run.status === 'running').length
  const latestAttempt = attempts[0]
  const latestDelivery = deliveries[0]
  const latestAlert = quoteAlerts[0]

  function handleLeadUpdated(updatedLead: Lead) {
    setLeads((current) => current.map((lead) => lead.id === updatedLead.id ? updatedLead : lead))
    setSelectedLead(updatedLead)
    onLeadUpdated?.(updatedLead)
  }

  return (
    <>
      <section className="page-heading connected-page-heading">
        <div>
          <div className="eyebrow">AUTOMATION OBSERVABILITY</div>
          <h1>Automation Health Center</h1>
          <p>Read-only operational health across routing, AI, follow-up, outbound delivery, quote alerts and scheduled reporting.</p>
        </div>
        <button className="button secondary" type="button" onClick={() => void loadHealth(true)} disabled={refreshing || loading}>
          {refreshing ? 'Refreshing…' : '↻ Refresh health'}
        </button>
      </section>

      {error && <div className="error-banner">Health Center loaded with a warning: {error}</div>}
      {!runTelemetryReady && (
        <div className="health-info-banner">
          <strong>Normalized execution telemetry is pending the v1 database migration.</strong>
          <span>Existing routing, AI, delivery, alert and report ledgers are still live below.</span>
        </div>
      )}

      <section className="runlog-kpis health-kpis" aria-label="Automation health metrics">
        <article className={`runlog-kpi health-summary ${systemHealth}`}>
          <span>System health</span>
          <strong className="health-word">{loading ? '—' : healthLabel(systemHealth)}</strong>
          <small>{loading ? 'Loading health signals' : recentIncidents.length ? `${recentIncidents.length} incident${recentIncidents.length === 1 ? '' : 's'} in the last 24h` : 'No active failure signals in the last 24h'}</small>
        </article>
        <article className="runlog-kpi success">
          <span>Automations observed</span>
          <strong>{loading ? '—' : healthCards.length}</strong>
          <small>Routing, AI, follow-up, outbound, alerts and reporting</small>
        </article>
        <article className={recentIncidents.length ? 'runlog-kpi failed' : 'runlog-kpi'}>
          <span>Failures · 24h</span>
          <strong>{loading ? '—' : recentIncidents.length}</strong>
          <small>{failedRuns24h ? `${failedRuns24h} from normalized execution runs` : 'Derived from tenant-safe failure ledgers'}</small>
        </article>
        <article className="runlog-kpi suppressed">
          <span>Normalized runs</span>
          <strong>{loading ? '—' : runTelemetryReady ? runs.length : 'Pending'}</strong>
          <small>{runTelemetryReady ? (latestRun ? `Latest: ${healthLabel(latestRun.status === 'failed' ? 'attention' : latestRun.status === 'running' ? 'waiting' : 'healthy')}${runningRuns ? ` · ${runningRuns} running` : ''}` : 'Schema ready; producers not instrumented yet') : 'Migration not applied in this environment yet'}</small>
        </article>
      </section>

      <section className="health-card-grid" aria-label="Automation status cards">
        {healthCards.map((card) => (
          <article className={`panel health-automation-card ${card.state}`} key={card.key}>
            <div className="health-card-topline">
              <div>
                <span className="mini-label">{card.source}</span>
                <h2>{card.name}</h2>
              </div>
              <span className={`health-state ${card.state}`}><i />{healthLabel(card.state)}</span>
            </div>
            <strong className="health-card-status">{card.status}</strong>
            <p>{card.note}</p>
            <div className="health-card-meta">
              <span>{card.metric}</span>
              <span>{compactDate(card.lastAt)}</span>
            </div>
          </article>
        ))}
      </section>

      <section className="health-detail-grid">
        <article className="panel health-incidents-panel">
          <div className="health-section-heading">
            <div>
              <span className="mini-label">RECENT INCIDENTS</span>
              <h2>Failures that need review</h2>
            </div>
            <span className={`health-state ${recentIncidents.length ? 'attention' : 'healthy'}`}><i />{recentIncidents.length ? `${recentIncidents.length} recent` : 'Clear'}</span>
          </div>
          <div className="health-incident-list">
            {incidents.map((incident) => (
              <div className="health-incident" key={incident.id}>
                <span className="health-incident-dot" />
                <div>
                  <div className="health-incident-title"><strong>{incident.title}</strong><span>{incident.automation}</span></div>
                  <p>{incident.detail}</p>
                </div>
                <time>{compactDate(incident.at)}</time>
              </div>
            ))}
            {!loading && incidents.length === 0 && (
              <div className="health-empty-state">
                <strong>No failure incidents in the loaded history.</strong>
                <span>Disabled automations and periods with no eligible work are not counted as failures.</span>
              </div>
            )}
            {loading && <div className="health-empty-state"><strong>Loading incident history…</strong></div>}
          </div>
        </article>

        <article className="panel health-delivery-panel">
          <div className="health-section-heading">
            <div>
              <span className="mini-label">DELIVERY STATE</span>
              <h2>Outbound & alerts</h2>
            </div>
          </div>
          <div className="health-ledger-list">
            <div className="health-ledger-row">
              <span>Outbound delivery</span>
              <strong>{latestDelivery ? latestDelivery.status : 'No rows'}</strong>
              <small>{latestDelivery ? `${latestDelivery.mode}${latestDelivery.provider ? ` · ${latestDelivery.provider}` : ''} · ${compactDate(latestDelivery.last_attempt_at || latestDelivery.created_at)}` : 'Waiting for first logical delivery'}</small>
            </div>
            <div className="health-ledger-row">
              <span>Latest attempt</span>
              <strong>{latestAttempt ? latestAttempt.status : 'No rows'}</strong>
              <small>{latestAttempt ? `${safeDetail(latestAttempt.error_message || latestAttempt.error_code, 'No provider error recorded')} · ${compactDate(latestAttempt.attempted_at)}` : 'No provider or simulation attempt recorded'}</small>
            </div>
            <div className="health-ledger-row">
              <span>Quote alert</span>
              <strong>{latestAlert ? latestAlert.status : 'No rows'}</strong>
              <small>{latestAlert ? `${latestAlert.channel} · ${latestAlert.alert_type.replace(/_/g, ' ')} · ${compactDate(latestAlert.last_attempt_at || latestAlert.created_at)}` : 'No quote-alert delivery recorded'}</small>
            </div>
            <div className="health-ledger-row">
              <span>Execution heartbeat</span>
              <strong>{latestRun ? latestRun.status : runTelemetryReady ? 'No runs yet' : 'Pending migration'}</strong>
              <small>{latestRun ? `${latestRun.automation_name} · ${prettySource(latestRun.source)} · ${compactDate(latestRun.finished_at || latestRun.started_at)}` : 'Trusted producers will populate normalized execution history incrementally.'}</small>
            </div>
          </div>
        </article>
      </section>

      <section className="panel runlog-panel health-routing-panel">
        <div className="runlog-toolbar">
          <div>
            <span className="mini-label">ROUTING DIAGNOSTICS</span>
            <h2>Lead routing event log</h2>
            <p className="health-toolbar-copy">Existing detailed routing history remains available for event-level troubleshooting.</p>
          </div>
          <div className="runlog-filters">
            <select value={routeFilter} onChange={(event) => setRouteFilter(event.target.value as RouteFilter)} aria-label="Filter by route">
              <option value="all">All routes</option>
              <option value="Hot">Hot</option>
              <option value="Warm">Warm</option>
              <option value="Cold">Cold</option>
            </select>
            <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value as ResultFilter)} aria-label="Filter by result">
              <option value="all">All results</option>
              <option value="accepted">Started</option>
              <option value="suppressed_24h">Suppressed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        <div className="health-routing-mini-stats" aria-label="Routing event summary">
          <span><strong>{loading ? '—' : routingStats.total}</strong> total</span>
          <span><strong>{loading ? '—' : routingStats.started}</strong> started</span>
          <span><strong>{loading ? '—' : routingStats.suppressed}</strong> suppressed</span>
          <span><strong>{loading ? '—' : routingStats.failed}</strong> failed</span>
        </div>

        <div className="table-wrap runlog-table-wrap">
          <table>
            <thead><tr><th>Lead</th><th>Route change</th><th>Result</th><th>Triggered</th><th>Changed</th><th>Event ID</th></tr></thead>
            <tbody>
              {filtered.map((event) => {
                const lead = leadMap.get(event.lead_id)
                return (
                  <tr key={event.id} className={lead ? 'runlog-row clickable' : 'runlog-row'} onClick={() => lead && setSelectedLead(lead)}>
                    <td>
                      <div className="runlog-lead">
                        <strong>{lead?.name || `Lead #${event.lead_id}`}</strong>
                        <span>{lead?.email || (lead?.archived_at ? 'Archived lead' : 'Lead record unavailable')}</span>
                      </div>
                    </td>
                    <td><span className={`runlog-route ${routeClass(event.to_status)}`}>{event.from_status || 'Unclassified'} → {event.to_status}</span></td>
                    <td><span className={`runlog-result ${resultClass(event.automation_result)}`}>{resultLabel(event.automation_result)}</span></td>
                    <td>{event.automation_triggered ? 'Yes' : 'No'}</td>
                    <td>{compactDate(event.changed_at)}</td>
                    <td><code>{event.event_key.slice(0, 8)}</code></td>
                  </tr>
                )
              })}
              {!loading && filtered.length === 0 && <tr><td className="empty-cell" colSpan={6}>No automation events match these filters.</td></tr>}
              {loading && <tr><td className="empty-cell" colSpan={6}>Loading automation activity…</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {selectedLead && <LeadProfileDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} onUpdated={handleLeadUpdated} />}
    </>
  )
}
