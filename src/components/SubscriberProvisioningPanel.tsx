import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type ProvisioningResponse = {
  request_id?: string
  error?: string
}

export default function SubscriberProvisioningPanel() {
  const [email, setEmail] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [planCode, setPlanCode] = useState('starter')
  const [billingCycle, setBillingCycle] = useState('monthly')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (!supabase) {
      setError('Supabase is not configured for this environment.')
      return
    }

    setSubmitting(true)
    const { data, error: invokeError } = await supabase.functions.invoke<ProvisioningResponse>(
      'admin-provision-subscriber',
      {
        body: {
          email: email.trim(),
          workspace_name: workspaceName.trim(),
          plan_code: planCode,
          billing_cycle: billingCycle,
        },
      },
    )
    setSubmitting(false)

    if (invokeError || data?.error) {
      setError(data?.error || invokeError?.message || 'The invitation could not be sent.')
      return
    }

    setSuccess(`Invitation sent. Request ${data?.request_id || 'created'} will activate after the customer accepts.`)
    setEmail('')
    setWorkspaceName('')
  }

  return (
    <article className="panel settings-section-card subscriber-provisioning-card">
      <div className="settings-section-heading">
        <div>
          <span className="mini-label">PLATFORM ADMIN</span>
          <h2>Provision a subscriber</h2>
          <p>Invite a new customer and pre-approve the plan their workspace receives after first sign-in.</p>
        </div>
        <span className="policy-state active">Server secured</span>
      </div>

      {error && <div className="settings-inline-message error" role="alert">{error}</div>}
      {success && <div className="settings-inline-message success" role="status">{success}</div>}

      <form className="subscriber-provisioning-form" onSubmit={handleSubmit}>
        <label>
          <span>Customer email</span>
          <input
            type="email"
            autoComplete="email"
            required
            placeholder="founder@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          <span>Workspace name</span>
          <input
            type="text"
            minLength={2}
            maxLength={100}
            required
            placeholder="Acme Sales"
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)}
          />
        </label>
        <label>
          <span>Plan</span>
          <select value={planCode} onChange={(event) => setPlanCode(event.target.value)}>
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
            <option value="white_label">White Label</option>
            <option value="free">Free</option>
          </select>
        </label>
        <label>
          <span>Billing cycle</span>
          <select
            value={planCode === 'white_label' ? 'custom' : planCode === 'free' ? 'none' : billingCycle}
            disabled={planCode === 'white_label' || planCode === 'free'}
            onChange={(event) => setBillingCycle(event.target.value)}
          >
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
            <option value="custom">Custom</option>
            <option value="none">None</option>
          </select>
        </label>
        <button className="button primary" type="submit" disabled={submitting}>
          {submitting ? 'Sending secure invite…' : 'Send subscriber invite'}
        </button>
      </form>

      <p className="settings-note subscriber-provisioning-note">
        Smart CRM sends a Supabase invite. No temporary password is created or shared. The plan activates only when this exact email accepts and opens its new workspace.
      </p>
    </article>
  )
}
