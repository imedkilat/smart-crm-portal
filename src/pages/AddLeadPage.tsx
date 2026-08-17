import { FormEvent, useRef, useState } from 'react'

const LEAD_WEBHOOK_URL =
  import.meta.env.VITE_N8N_LEAD_WEBHOOK_URL ||
  'https://tolakautomations.app.n8n.cloud/webhook/799b1d66-0a5f-44b0-8f43-600ea4775979'

type Props = {
  onCreated?: () => void
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error'

function today() {
  return new Date().toLocaleDateString('en-US')
}

export default function AddLeadPage({ onCreated }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [budget, setBudget] = useState('')
  const [message, setMessage] = useState('')
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [feedback, setFeedback] = useState('')
  const [uploadState, setUploadState] = useState<SubmitState>('idle')
  const [uploadFeedback, setUploadFeedback] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function submitManualLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitState('submitting')
    setFeedback('Sending lead through AI classification…')

    try {
      const response = await fetch(LEAD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submission_type: 'manual_add',
          upload_date: today(),
          name: name.trim(),
          email: email.trim(),
          budget: budget.trim(),
          message: message.trim(),
        }),
      })

      if (!response.ok) {
        throw new Error(`Workflow returned ${response.status}`)
      }

      setSubmitState('success')
      setFeedback('Lead classified and sent to the CRM pipeline.')
      setName('')
      setEmail('')
      setBudget('')
      setMessage('')
      onCreated?.()
    } catch (error) {
      setSubmitState('error')
      setFeedback(error instanceof Error ? error.message : 'The workflow could not process this lead.')
    }
  }

  async function uploadExcel() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setUploadState('error')
      setUploadFeedback('Choose an Excel file first.')
      return
    }

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setUploadState('error')
      setUploadFeedback('Use an .xlsx workbook for this intake workflow.')
      return
    }

    setUploadState('submitting')
    setUploadFeedback('Uploading and classifying spreadsheet leads…')

    try {
      const form = new FormData()
      form.append('submission_type', 'excel_file')
      form.append('upload_date', today())
      form.append('file', file)

      const response = await fetch(LEAD_WEBHOOK_URL, {
        method: 'POST',
        body: form,
      })

      if (!response.ok) {
        throw new Error(`Workflow returned ${response.status}`)
      }

      setUploadState('success')
      setUploadFeedback('Spreadsheet sent to the AI intake workflow successfully.')
      if (fileRef.current) fileRef.current.value = ''
      onCreated?.()
    } catch (error) {
      setUploadState('error')
      setUploadFeedback(error instanceof Error ? error.message : 'The spreadsheet could not be processed.')
    }
  }

  return (
    <>
      <section className="page-heading connected-page-heading">
        <div>
          <div className="eyebrow">AI-ASSISTED INTAKE</div>
          <h1>Add Lead</h1>
          <p>Send a lead through n8n and Gemini for classification before it is stored in Supabase.</p>
        </div>
        <span className="workflow-live-pill"><i /> n8n workflow connected</span>
      </section>

      <section className="add-lead-layout">
        <form className="panel lead-form-card" onSubmit={submitManualLead}>
          <div className="form-card-heading">
            <div>
              <span className="mini-label">MANUAL CAPTURE</span>
              <h2>New lead details</h2>
              <p>Category, intent and AI summary are generated automatically.</p>
            </div>
            <span className="form-step">01</span>
          </div>

          <div className="crm-form-grid">
            <label className="crm-field">
              <span>Full name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Jordan Rivera" required />
            </label>

            <label className="crm-field">
              <span>Email</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="jordan@company.com" type="email" required />
            </label>

            <label className="crm-field crm-field-full">
              <span>Budget</span>
              <input value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="e.g. 5000 or $5,000" inputMode="decimal" />
            </label>

            <label className="crm-field crm-field-full">
              <span>Lead message / inquiry</span>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="What is the lead looking for? Include urgency, needs and useful context for the AI classifier."
                rows={7}
                required
              />
            </label>
          </div>

          <div className="form-submit-row">
            <div className={`form-feedback ${submitState}`}>
              {feedback || 'The workflow will classify this as Hot, Warm or Cold and identify its intent.'}
            </div>
            <button className="button primary submit-lead-button" type="submit" disabled={submitState === 'submitting'}>
              {submitState === 'submitting' ? 'Processing…' : 'Classify & add lead'}
            </button>
          </div>
        </form>

        <aside className="add-lead-side">
          <article className="panel workflow-preview-card">
            <span className="mini-label">WHAT HAPPENS NEXT</span>
            <h2>Automated intake flow</h2>
            <div className="intake-steps">
              {[
                ['01', 'Webhook receives lead', 'Secure POST from this workspace to n8n.'],
                ['02', 'Gemini classifies', 'Category, intent and summary are generated from the inquiry.'],
                ['03', 'Supabase stores record', 'The structured lead becomes available across the CRM.'],
                ['04', 'Follow-up engine', 'Downstream automation can route outreach by lead quality.'],
              ].map(([step, title, copy]) => (
                <div className="intake-step" key={step}>
                  <span>{step}</span>
                  <div><strong>{title}</strong><p>{copy}</p></div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel excel-upload-card">
            <span className="mini-label">BULK INTAKE</span>
            <h2>Upload Excel leads</h2>
            <p>Send an .xlsx workbook through the same workflow for row-by-row AI classification.</p>
            <label className="file-drop">
              <input ref={fileRef} type="file" accept=".xlsx" />
              <span className="file-icon">⇧</span>
              <strong>Choose spreadsheet</strong>
              <small>.xlsx workbook</small>
            </label>
            <button className="button secondary upload-button" type="button" onClick={uploadExcel} disabled={uploadState === 'submitting'}>
              {uploadState === 'submitting' ? 'Uploading…' : 'Upload to workflow'}
            </button>
            {uploadFeedback && <div className={`form-feedback upload-feedback ${uploadState}`}>{uploadFeedback}</div>}
          </article>
        </aside>
      </section>
    </>
  )
}
