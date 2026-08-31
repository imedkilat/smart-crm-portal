import { useMemo, useState } from 'react'
import '../automation-lab.css'

type TriggerKey = 'lead_created' | 'status_changed' | 'quote_sent'
type ConditionKey = 'hot_lead' | 'budget_5k' | 'quote_stale'
type ActionKey = 'create_task' | 'move_pipeline' | 'simulate_email'

type SyntheticLead = {
  id: string
  name: string
  company: string
  category: 'Hot' | 'Warm' | 'Cold'
  budget: number
  quoteAgeHours: number
}

type TraceItem = {
  id: string
  label: string
  detail: string
  state: 'success' | 'info' | 'stopped'
}

const syntheticLeads: SyntheticLead[] = [
  { id: 'demo-hot', name: 'Jordan Reyes', company: 'Northstar Labs', category: 'Hot', budget: 12000, quoteAgeHours: 6 },
  { id: 'demo-warm', name: 'Maya Chen', company: 'Orbit Studio', category: 'Warm', budget: 7200, quoteAgeHours: 55 },
  { id: 'demo-cold', name: 'Alex Morgan', company: 'Harbor & Co.', category: 'Cold', budget: 2400, quoteAgeHours: 10 },
]

const triggerLabels: Record<TriggerKey, string> = {
  lead_created: 'New lead created',
  status_changed: 'Lead status changed',
  quote_sent: 'Quote sent',
}

const conditionLabels: Record<ConditionKey, string> = {
  hot_lead: 'AI category is Hot',
  budget_5k: 'Budget is at least $5,000',
  quote_stale: 'Quote pending for 48+ hours',
}

const actionLabels: Record<ActionKey, string> = {
  create_task: 'Create follow-up task',
  move_pipeline: 'Move to Hot pipeline',
  simulate_email: 'Simulate follow-up email',
}

function conditionPasses(condition: ConditionKey, lead: SyntheticLead) {
  if (condition === 'hot_lead') return lead.category === 'Hot'
  if (condition === 'budget_5k') return lead.budget >= 5000
  return lead.quoteAgeHours >= 48
}

function actionDetail(action: ActionKey, lead: SyntheticLead) {
  if (action === 'create_task') return `Task staged for ${lead.name}: follow up within 2 hours.`
  if (action === 'move_pipeline') return `${lead.name} would move into the Hot pipeline stage.`
  return `Email rendered for ${lead.name}. Delivery is simulated only, with no provider call.`
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export default function AutomationLabPage() {
  const [trigger, setTrigger] = useState<TriggerKey>('lead_created')
  const [condition, setCondition] = useState<ConditionKey>('hot_lead')
  const [primaryAction, setPrimaryAction] = useState<ActionKey>('create_task')
  const [secondaryAction, setSecondaryAction] = useState<ActionKey>('simulate_email')
  const [leadId, setLeadId] = useState(syntheticLeads[0].id)
  const [trace, setTrace] = useState<TraceItem[]>([])
  const [running, setRunning] = useState(false)

  const lead = useMemo(() => syntheticLeads.find((item) => item.id === leadId) || syntheticLeads[0], [leadId])
  const matched = conditionPasses(condition, lead)

  async function runWorkflow() {
    if (running) return
    setRunning(true)
    setTrace([])

    const items: TraceItem[] = []
    const push = async (item: TraceItem) => {
      items.push(item)
      setTrace([...items])
      await delay(320)
    }

    await push({
      id: 'trigger',
      label: 'Trigger received',
      detail: `${triggerLabels[trigger]} fired for synthetic lead ${lead.name}.`,
      state: 'success',
    })

    await push({
      id: 'context',
      label: 'Synthetic context loaded',
      detail: `${lead.company} · ${lead.category} · $${lead.budget.toLocaleString()} budget · quote age ${lead.quoteAgeHours}h.`,
      state: 'info',
    })

    if (!matched) {
      await push({
        id: 'condition',
        label: 'Condition did not match',
        detail: `${conditionLabels[condition]} evaluated false. Workflow stopped without actions.`,
        state: 'stopped',
      })
      setRunning(false)
      return
    }

    await push({
      id: 'condition',
      label: 'Condition matched',
      detail: `${conditionLabels[condition]} evaluated true.`,
      state: 'success',
    })

    await push({
      id: 'primary-action',
      label: actionLabels[primaryAction],
      detail: actionDetail(primaryAction, lead),
      state: 'success',
    })

    if (secondaryAction !== primaryAction) {
      await push({
        id: 'secondary-action',
        label: actionLabels[secondaryAction],
        detail: actionDetail(secondaryAction, lead),
        state: 'success',
      })
    }

    await push({
      id: 'complete',
      label: 'Simulation complete',
      detail: '0 database writes · 0 n8n calls · 0 provider calls. The execution trace exists only in this browser session.',
      state: 'info',
    })

    setRunning(false)
  }

  function resetWorkflow() {
    setTrigger('lead_created')
    setCondition('hot_lead')
    setPrimaryAction('create_task')
    setSecondaryAction('simulate_email')
    setLeadId(syntheticLeads[0].id)
    setTrace([])
  }

  return (
    <main className="automation-lab-shell">
      <header className="automation-lab-nav">
        <a className="automation-lab-brand" href="https://imedkilat.com/" aria-label="Back to Ed Rowell Kilat portfolio">
          <span className="automation-lab-mark">S</span>
          <span>Smart CRM</span>
        </a>
        <div className="automation-lab-nav-actions">
          <span className="sandbox-badge">Public sandbox</span>
          <a href="/login" className="lab-link-button">Open full CRM ↗</a>
        </div>
      </header>

      <section className="automation-lab-hero">
        <div className="lab-kicker">INTERACTIVE AUTOMATION LAB</div>
        <h1>Build a workflow. Run it safely.</h1>
        <p>
          Experience the decision logic behind Smart CRM automation without creating an account.
          Configure a trigger, condition, and actions, then run the workflow against synthetic CRM data.
        </p>
        <div className="lab-safety-strip" aria-label="Sandbox safety guarantees">
          <span>✓ Synthetic records only</span>
          <span>✓ No database writes</span>
          <span>✓ No email sends</span>
          <span>✓ No production automation calls</span>
        </div>
      </section>

      <section className="automation-lab-grid">
        <div className="lab-builder-card">
          <div className="lab-section-heading">
            <div>
              <span className="lab-mini-label">WORKFLOW BUILDER</span>
              <h2>Configure the flow</h2>
            </div>
            <button type="button" className="lab-reset" onClick={resetWorkflow} disabled={running}>Reset</button>
          </div>

          <div className="workflow-stack">
            <label className="workflow-node trigger-node">
              <span className="node-number">01</span>
              <span className="node-copy"><b>Trigger</b><small>What starts the workflow?</small></span>
              <select aria-label="Workflow trigger" value={trigger} onChange={(event) => setTrigger(event.target.value as TriggerKey)} disabled={running}>
                {Object.entries(triggerLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>

            <div className="workflow-connector"><span>↓</span></div>

            <label className="workflow-node condition-node">
              <span className="node-number">02</span>
              <span className="node-copy"><b>Condition</b><small>Should the automation continue?</small></span>
              <select aria-label="Workflow condition" value={condition} onChange={(event) => setCondition(event.target.value as ConditionKey)} disabled={running}>
                {Object.entries(conditionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>

            <div className="workflow-connector"><span>↓</span></div>

            <label className="workflow-node action-node">
              <span className="node-number">03</span>
              <span className="node-copy"><b>Action</b><small>What should happen next?</small></span>
              <select aria-label="Primary workflow action" value={primaryAction} onChange={(event) => setPrimaryAction(event.target.value as ActionKey)} disabled={running}>
                {Object.entries(actionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>

            <div className="workflow-connector"><span>↓</span></div>

            <label className="workflow-node action-node secondary-node">
              <span className="node-number">04</span>
              <span className="node-copy"><b>Then</b><small>Add another outcome.</small></span>
              <select aria-label="Secondary workflow action" value={secondaryAction} onChange={(event) => setSecondaryAction(event.target.value as ActionKey)} disabled={running}>
                {Object.entries(actionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
          </div>
        </div>

        <aside className="lab-run-card">
          <div className="lab-section-heading compact">
            <div>
              <span className="lab-mini-label">TEST RECORD</span>
              <h2>Choose a synthetic lead</h2>
            </div>
          </div>

          <label className="scenario-picker">
            <span>Lead scenario</span>
            <select aria-label="Synthetic lead scenario" value={leadId} onChange={(event) => setLeadId(event.target.value)} disabled={running}>
              {syntheticLeads.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.category}</option>)}
            </select>
          </label>

          <div className="synthetic-record">
            <div className="synthetic-avatar">{lead.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</div>
            <div><strong>{lead.name}</strong><span>{lead.company}</span></div>
            <span className={`synthetic-category ${lead.category.toLowerCase()}`}>{lead.category}</span>
            <dl>
              <div><dt>Budget</dt><dd>${lead.budget.toLocaleString()}</dd></div>
              <div><dt>Quote age</dt><dd>{lead.quoteAgeHours}h</dd></div>
              <div><dt>Condition preview</dt><dd className={matched ? 'preview-pass' : 'preview-stop'}>{matched ? 'Will match' : 'Will stop'}</dd></div>
            </dl>
          </div>

          <button className="lab-run-button" type="button" onClick={() => void runWorkflow()} disabled={running}>
            {running ? 'Running simulation…' : 'Run workflow →'}
          </button>
          <p className="lab-run-note">Runs locally in your browser. Refreshing the page clears the trace.</p>
        </aside>
      </section>

      <section className="execution-panel" aria-live="polite">
        <div className="lab-section-heading">
          <div>
            <span className="lab-mini-label">EXECUTION TRACE</span>
            <h2>See what the automation decided</h2>
          </div>
          <span className="zero-write-pill">0 external writes</span>
        </div>

        {trace.length === 0 ? (
          <div className="trace-empty">Configure the workflow above, choose a synthetic lead, then run it to see each decision step.</div>
        ) : (
          <ol className="trace-list">
            {trace.map((item, index) => (
              <li key={item.id} className={`trace-item ${item.state}`}>
                <span className="trace-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="trace-status">{item.state === 'stopped' ? '■' : '✓'}</span>
                <div><strong>{item.label}</strong><p>{item.detail}</p></div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="lab-explainer">
        <div>
          <span className="lab-mini-label">BEHIND THE DEMO</span>
          <h2>The production system goes deeper.</h2>
        </div>
        <p>
          This lab mirrors the trigger → decision → action mental model used across Smart CRM. The live product adds authenticated workspaces,
          tenant-scoped Supabase data, n8n orchestration, AI context, idempotency, audit ledgers, and controlled rollout gates.
        </p>
        <div className="lab-footer-actions">
          <a href="/login" className="lab-primary-cta">Explore the full CRM ↗</a>
          <a href="https://github.com/imedkilat/smart-crm-portal" target="_blank" rel="noreferrer" className="lab-secondary-cta">View source on GitHub ↗</a>
          <a href="https://imedkilat.com/" className="lab-secondary-cta">Back to portfolio ↗</a>
        </div>
      </section>
    </main>
  )
}
