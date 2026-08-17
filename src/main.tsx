import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import './styles.css'

function currentRoute() {
  return window.location.pathname.replace(/\/+$/, '') || '/'
}

const route = currentRoute()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {route === '/login' ? (
      <Login onSignedIn={() => window.location.assign('/')} />
    ) : route === '/reset-password' ? (
      <ResetPassword />
    ) : (
      <App />
    )}
  </StrictMode>,
)
