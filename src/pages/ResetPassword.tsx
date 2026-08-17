import { useState, type FormEvent } from 'react'
import { updatePassword } from '../lib/auth'
import '../auth.css'

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Use at least 8 characters for your new password.')
      return
    }

    if (password !== confirmPassword) {
      setError('The passwords do not match.')
      return
    }

    setSubmitting(true)
    const result = await updatePassword(password)
    setSubmitting(false)

    if (!result.ok) {
      setError(result.message)
      return
    }

    setDone(true)
  }

  return (
    <div className="auth-reset-shell">
      <div className="auth-reset-card">
        <div className="auth-mobile-brand auth-reset-brand">
          <div className="auth-logo"><LogoMark /></div>
          <strong>Smart CRM</strong>
        </div>

        {!done ? (
          <>
            <span className="auth-form-kicker">SECURE RECOVERY</span>
            <h2>Choose a new password</h2>
            <p className="auth-subtitle">Set a new password for your Smart CRM workspace account.</p>

            {error && <div className="auth-error" role="alert">{error}</div>}

            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="auth-field">
                <span>New password</span>
                <div className="auth-password-wrap">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    className="auth-password-toggle"
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </label>

              <label className="auth-field">
                <span>Confirm password</span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Repeat your new password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>

              <button className="auth-submit" type="submit" disabled={submitting}>
                {submitting ? <><span className="auth-spinner" /> Updating…</> : 'Update password'}
              </button>
            </form>
          </>
        ) : (
          <div className="auth-success-view">
            <div className="auth-success-icon">✓</div>
            <span className="auth-form-kicker">PASSWORD UPDATED</span>
            <h2>You&apos;re all set</h2>
            <p className="auth-subtitle">Your password has been updated successfully.</p>
            <button className="auth-submit" type="button" onClick={() => window.location.assign('/login')}>Return to sign in</button>
          </div>
        )}
      </div>
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
