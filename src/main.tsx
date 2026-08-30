import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import QuoteLifecyclePage from './pages/QuoteLifecyclePage'
import { signOut } from './lib/auth'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { ensureWorkspaceOnboarding } from './lib/workspace'
import './styles.css'
import './session.css'
import './global-search.css'

const RETURN_TO_KEY = 'smartcrm:returnTo'

type WorkspaceBootState = 'idle' | 'checking' | 'ready' | 'error'

function currentRoute() {
  return window.location.pathname.replace(/\/+$/, '') || '/'
}

function protectedReturnPath() {
  const candidate = window.sessionStorage.getItem(RETURN_TO_KEY)
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//') || candidate === '/login') {
    return '/dashboard'
  }
  return candidate
}

function consumeReturnPath() {
  const path = protectedReturnPath()
  window.sessionStorage.removeItem(RETURN_TO_KEY)
  return path
}

function workspaceNameFromMetadata(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.workspace_name
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function AuthLoading({ message = 'Checking workspace access…' }: { message?: string }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        background: '#f6f8fc',
        color: '#7a8498',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: '13px',
      }}
    >
      {message}
    </div>
  )
}

function WorkspaceProblem({ message, onRetry, onSignOut, signingOut }: {
  message: string
  onRetry: () => void
  onSignOut: () => void
  signingOut: boolean
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        background: '#f6f8fc',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div style={{ width: 'min(430px, 100%)', padding: '28px', border: '1px solid #e1e6ef', borderRadius: '16px', background: '#fff' }}>
        <strong style={{ display: 'block', color: '#172033', fontSize: '18px' }}>Workspace setup needs attention</strong>
        <p style={{ margin: '10px 0 22px', color: '#6f7a8f', fontSize: '13px', lineHeight: 1.6 }}>{message}</p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className="button primary" type="button" onClick={onRetry}>Retry workspace setup</button>
          <button className="button secondary" type="button" onClick={onSignOut} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AuthRouter() {
  const route = currentRoute()
  const [authReady, setAuthReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [sessionUserId, setSessionUserId] = useState<string | null>(null)
  const [workspaceNameHint, setWorkspaceNameHint] = useState<string | null | undefined>(undefined)
  const [workspaceState, setWorkspaceState] = useState<WorkspaceBootState>('idle')
  const [workspaceError, setWorkspaceError] = useState('')
  const [onboardingAttempt, setOnboardingAttempt] = useState(0)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    let active = true

    function applySession(session: Awaited<ReturnType<NonNullable<typeof supabase>['auth']['getSession']>>['data']['session']) {
      if (!active) return
      const nextSignedIn = Boolean(session)
      setSignedIn(nextSignedIn)
      setSessionUserId(session?.user.id || null)
      setWorkspaceNameHint(session ? workspaceNameFromMetadata(session.user.user_metadata) : null)
      if (!nextSignedIn) {
        setWorkspaceState('idle')
        setWorkspaceError('')
      }
      setAuthReady(true)
    }

    async function loadSession() {
      if (!isSupabaseConfigured || !supabase) {
        applySession(null)
        return
      }

      const { data } = await supabase.auth.getSession()
      applySession(data.session)
    }

    void loadSession()

    if (!supabase) {
      return () => {
        active = false
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!authReady || !signedIn || !sessionUserId || workspaceNameHint === undefined) return

    let active = true
    setWorkspaceState('checking')
    setWorkspaceError('')

    void ensureWorkspaceOnboarding(workspaceNameHint).then((result) => {
      if (!active) return
      if (!result.ok) {
        setWorkspaceState('error')
        setWorkspaceError(result.message)
        return
      }
      setWorkspaceState('ready')
    })

    return () => {
      active = false
    }
  }, [authReady, signedIn, sessionUserId, workspaceNameHint, onboardingAttempt])

  useEffect(() => {
    if (!authReady) return

    if (route === '/login' && signedIn && workspaceState === 'ready') {
      window.location.replace(consumeReturnPath())
      return
    }

    if (route !== '/login' && route !== '/reset-password' && !signedIn) {
      window.sessionStorage.setItem(RETURN_TO_KEY, `${window.location.pathname}${window.location.search}`)
      window.location.replace('/login')
    }
  }, [authReady, route, signedIn, workspaceState])

  async function handleSignOut() {
    setSigningOut(true)
    await signOut()
    setSigningOut(false)
  }

  function handleSignedIn() {
    setWorkspaceState('checking')
  }

  if (route === '/reset-password') {
    return <ResetPassword />
  }

  if (!authReady) {
    return <AuthLoading />
  }

  if (signedIn && workspaceState === 'error') {
    return (
      <WorkspaceProblem
        message={workspaceError}
        onRetry={() => setOnboardingAttempt((value) => value + 1)}
        onSignOut={() => void handleSignOut()}
        signingOut={signingOut}
      />
    )
  }

  if (route === '/login') {
    if (signedIn) return <AuthLoading message="Opening workspace…" />
    return <Login onSignedIn={handleSignedIn} />
  }

  if (!signedIn) {
    return <AuthLoading message="Redirecting to sign in…" />
  }

  if (workspaceState !== 'ready') {
    return <AuthLoading message="Preparing your workspace…" />
  }

  if (route === '/quotes') {
    return (
      <>
        <QuoteLifecyclePage />
        <button
          className="session-signout"
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          aria-label="Sign out of Smart CRM"
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </>
    )
  }

  return (
    <>
      <App />
      <button
        className="session-signout"
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        aria-label="Sign out of Smart CRM"
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthRouter />
  </StrictMode>,
)
