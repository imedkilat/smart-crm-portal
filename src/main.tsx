import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import { signOut } from './lib/auth'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import './styles.css'
import './session.css'

function currentRoute() {
  return window.location.pathname.replace(/\/+$/, '') || '/'
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

function AuthRouter() {
  const route = currentRoute()
  const [authReady, setAuthReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    let active = true

    async function loadSession() {
      if (!isSupabaseConfigured || !supabase) {
        if (active) {
          setSignedIn(false)
          setAuthReady(true)
        }
        return
      }

      const { data } = await supabase.auth.getSession()
      if (active) {
        setSignedIn(Boolean(data.session))
        setAuthReady(true)
      }
    }

    loadSession()

    if (!supabase) {
      return () => {
        active = false
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      setSignedIn(Boolean(session))
      setAuthReady(true)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!authReady) return

    if (route === '/login' && signedIn) {
      window.location.replace('/')
      return
    }

    if (route !== '/login' && route !== '/reset-password' && !signedIn) {
      window.location.replace('/login')
    }
  }, [authReady, route, signedIn])

  async function handleSignOut() {
    setSigningOut(true)
    await signOut()
    setSigningOut(false)
  }

  if (route === '/reset-password') {
    return <ResetPassword />
  }

  if (!authReady) {
    return <AuthLoading />
  }

  if (route === '/login') {
    return signedIn ? <AuthLoading message="Opening workspace…" /> : <Login onSignedIn={() => window.location.assign('/')} />
  }

  if (!signedIn) {
    return <AuthLoading message="Redirecting to sign in…" />
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
