import { useState, type FormEvent } from 'react'
import { sendPasswordReset, signIn } from '../lib/auth'
import '../auth.css'

type View = 'signin' | 'reset' | 'sent'

const steps = [
  ['01', 'Lead captured', 'Forms, uploads, manual intake'],
  ['02', 'AI classified', 'Intent + Hot / Warm / Cold'],
  ['03', 'CRM updated', 'Structured data stored'],
  ['04', 'Follow-up triggered', 'Routing and outreach'],
]

function emailProblem(value: string) {
  if (!value.trim()) return 'Enter your email address.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())) return 'That email address looks incomplete.'
  return ''
}

export default function Login({ onSignedIn }: { onSignedIn?: () => void }) {
  const [view, setView] = useState<View>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resetEmail, setResetEmail] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')

  async function handleSignIn(event: FormEvent) {
    event.preventDefault()
    const nextEmailError = emailProblem(email)
    const nextPasswordError = password ? '' : 'Enter your password.'

    setEmailError(nextEmailError)
    setPasswordError(nextPasswordError)
    setError('')

    if (nextEmailError || nextPasswordError) return

    setSubmitting(true)
    const result = await signIn(email, password)
    setSubmitting(false)

    if (!result.ok) {
      setError(result.message)
      return
    }

    onSignedIn?.()
  }

  async function handleReset(event: FormEvent) {
    event.preventDefault()
    const target = resetEmail.trim()
    const problem = emailProblem(target)
    setEmailError(problem)
    setError('')
    if (problem) return

    setSubmitting(true)
    const result = await sendPasswordReset(target)
    setSubmitting(false)

    if (!result.ok) {
      setError(result.message)
      return
    }

    setSentTo(target)
    setView('sent')
  }

  function openReset() {
    setResetEmail(email)
    setEmailError('')
    setError('')
    setView('reset')
  }

  function backToSignIn() {
    setView('signin')
    setError('')
    setEmailError('')
    setPasswordError('')
  }

  return (
    <div className="auth-shell">
      <aside className="auth-panel">
        <div className="auth-grid" aria-hidden="true" />
        <div className="auth-orb auth-orb-one" aria-hidden="true" />
        <div className="auth-orb auth-orb-two" aria-hidden="true" />

        <div className="auth-brand">
          <div className="auth-logo"><LogoMark /></div>
          <div>
            <strong>Smart CRM</strong>
            <span>AI-powered lead operations</span>
          </div>
        </div>

        <div className="auth-story">
          <span className="auth-kicker">SMART CRM PORTAL · V2</span>
          <h1>Turn incoming leads into prioritized opportunities.</h1>
          <p>
            AI-powered classification, structured CRM updates, automated follow-up, and reporting in one focused workspace.
          </p>

          <div className="auth-flow" aria-label="Smart CRM automation flow">
            {steps.map(([step, label, meta], index) => (
              <div className="auth-flow-row" key={label}>
                <div className="auth-step-index">{step}</div>
                <div className="auth-flow-copy">
                  <strong>{label}</strong>
                  <span>{meta}</span>
                </div>
                <span className="auth-flow-check">✓</span>
                {index < steps.length - 1 && <span className="auth-flow-line" aria-hidden="true" />}
              </div>
            ))}
          </div>

          <article className="auth-insight-card">
            <div className="auth-insight-top">
              <div className="auth-spark"><SparkIcon /></div>
              <div>
                <strong>AI Lead Intelligence</strong>
                <span>Illustrative classification preview</span>
              </div>
            </div>
            <div className="auth-insight-tags">
              <span className="auth-tag hot"><i /> Hot Lead</span>
              <span className="auth-tag">Purchase Intent</span>
            </div>
            <div className="auth-insight-value">
              <div>
                <span>Sample potential value</span>
                <strong>$12.5k</strong>
              </div>
              <span>Example only</span>
            </div>
          </article>
        </div>

        <div className="auth-panel-foot">
          <span className="auth-live-dot" />
          AI-powered lead routing and reporting workspace
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          {view === 'signin' && (
            <>
              <div className="auth-mobile-brand">
                <div className="auth-logo"><LogoMark /></div>
                <strong>Smart CRM</strong>
              </div>
              <span className="auth-form-kicker">SECURE WORKSPACE</span>
              <h2>Welcome back</h2>
              <p className="auth-subtitle">Sign in to continue to your Smart CRM workspace.</p>

              {error && <div className="auth-error" role="alert">{error}</div>}

              <form className="auth-form" onSubmit={handleSignIn} noValidate>
                <label className="auth-field">
                  <span>Email address</span>
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    className={emailError ? 'invalid' : ''}
                    onChange={(event) => {
                      setEmail(event.target.value)
                      setEmailError('')
                      setError('')
                    }}
                  />
                  {emailError && <small>{emailError}</small>}
                </label>

                <label className="auth-field">
                  <span>Password</span>
                  <div className="auth-password-wrap">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={password}
                      className={passwordError ? 'invalid' : ''}
                      onChange={(event) => {
                        setPassword(event.target.value)
                        setPasswordError('')
                        setError('')
                      }}
                    />
                    <button
                      className="auth-password-toggle"
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                  {passwordError && <small>{passwordError}</small>}
                </label>

                <div className="auth-form-row">
                  <span className="auth-security-note">Protected workspace access</span>
                  <button className="auth-link" type="button" onClick={openReset}>Forgot password?</button>
                </div>

                <button className="auth-submit" type="submit" disabled={submitting}>
                  {submitting ? <><span className="auth-spinner" /> Signing in…</> : 'Sign in'}
                </button>
              </form>

              <p className="auth-invite-note">Workspace access is invite-only for this build.</p>
            </>
          )}

          {view === 'reset' && (
            <>
              <button className="auth-back" type="button" onClick={backToSignIn}>← Back to sign in</button>
              <span className="auth-form-kicker">ACCOUNT RECOVERY</span>
              <h2>Reset your password</h2>
              <p className="auth-subtitle">We&apos;ll email you a secure link to choose a new password.</p>

              {error && <div className="auth-error" role="alert">{error}</div>}

              <form className="auth-form" onSubmit={handleReset} noValidate>
                <label className="auth-field">
                  <span>Email address</span>
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={resetEmail}
                    className={emailError ? 'invalid' : ''}
                    onChange={(event) => {
                      setResetEmail(event.target.value)
                      setEmailError('')
                      setError('')
                    }}
                  />
                  {emailError && <small>{emailError}</small>}
                </label>
                <button className="auth-submit" type="submit" disabled={submitting}>
                  {submitting ? <><span className="auth-spinner" /> Sending…</> : 'Send reset link'}
                </button>
              </form>
            </>
          )}

          {view === 'sent' && (
            <div className="auth-success-view">
              <div className="auth-success-icon">✉</div>
              <span className="auth-form-kicker">CHECK YOUR INBOX</span>
              <h2>Reset link sent</h2>
              <p className="auth-subtitle">We sent a password reset link to <strong>{sentTo}</strong>.</p>
              <div className="auth-info-box">Use the link in the email to open the secure password reset screen.</div>
              <button className="auth-submit" type="button" onClick={backToSignIn}>Back to sign in</button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function LogoMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5.3 5.7 14.7 4M5.1 7.2v5.4M6.5 13.6l7.2 1.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="4.3" cy="5.2" r="2.2" fill="currentColor" />
      <circle cx="15.4" cy="3.8" r="1.6" fill="currentColor" opacity=".72" />
      <circle cx="4.4" cy="13.8" r="1.6" fill="currentColor" opacity=".72" />
      <circle cx="14.8" cy="15.7" r="2.2" fill="currentColor" />
    </svg>
  )
}

function SparkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M8 1.8 9.4 5l3.2 1.4-3.2 1.4L8 11 6.6 7.8 3.4 6.4 6.6 5 8 1.8Z" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M2.3 10s2.8-4.2 7.7-4.2 7.7 4.2 7.7 4.2-2.8 4.2-7.7 4.2S2.3 10 2.3 10Z" />
      <circle cx="10" cy="10" r="2.2" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="m3 3 14 14M8.4 6c.5-.1 1-.2 1.6-.2 4.9 0 7.7 4.2 7.7 4.2a13.4 13.4 0 0 1-2.4 2.7M11.8 14c-.6.1-1.2.2-1.8.2-4.9 0-7.7-4.2-7.7-4.2a13.3 13.3 0 0 1 2.5-2.8" />
    </svg>
  )
}
