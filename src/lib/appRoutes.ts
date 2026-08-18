import { useCallback, useEffect, useState } from 'react'

export type AppPage = 'dashboard' | 'pipeline' | 'tasks' | 'leads' | 'add' | 'automation' | 'analytics' | 'reports' | 'settings'

export type AppRoute = {
  page: AppPage
  leadPublicId: string | null
}

export const PAGE_PATHS: Record<AppPage, string> = {
  dashboard: '/dashboard',
  pipeline: '/pipeline',
  tasks: '/tasks',
  leads: '/leads',
  add: '/leads/new',
  automation: '/automation',
  analytics: '/analytics',
  reports: '/reports',
  settings: '/settings',
}

function cleanPath(pathname: string) {
  const cleaned = pathname.replace(/\/+$/, '')
  return cleaned || '/'
}

export function parseAppRoute(pathname = window.location.pathname): AppRoute {
  const path = cleanPath(pathname)

  if (path === '/' || path === '/dashboard') return { page: 'dashboard', leadPublicId: null }
  if (path === '/pipeline') return { page: 'pipeline', leadPublicId: null }
  if (path === '/tasks') return { page: 'tasks', leadPublicId: null }
  if (path === '/leads') return { page: 'leads', leadPublicId: null }
  if (path === '/leads/new') return { page: 'add', leadPublicId: null }
  if (path === '/automation') return { page: 'automation', leadPublicId: null }
  if (path === '/analytics') return { page: 'analytics', leadPublicId: null }
  if (path === '/reports') return { page: 'reports', leadPublicId: null }
  if (path === '/settings') return { page: 'settings', leadPublicId: null }

  const leadMatch = path.match(/^\/leads\/([^/]+)$/)
  if (leadMatch) {
    return {
      page: 'leads',
      leadPublicId: decodeURIComponent(leadMatch[1]),
    }
  }

  return { page: 'dashboard', leadPublicId: null }
}

export function leadPath(publicId: string | number) {
  return `/leads/${encodeURIComponent(String(publicId))}`
}

export function useAppRoute() {
  const [route, setRoute] = useState<AppRoute>(() => parseAppRoute())

  useEffect(() => {
    if (cleanPath(window.location.pathname) === '/') {
      window.history.replaceState({}, '', PAGE_PATHS.dashboard)
      setRoute({ page: 'dashboard', leadPublicId: null })
    }

    const handlePopState = () => setRoute(parseAppRoute())
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigatePath = useCallback((path: string, replace = false) => {
    const normalized = cleanPath(path)
    const current = cleanPath(window.location.pathname)

    if (normalized !== current) {
      if (replace) window.history.replaceState({}, '', normalized)
      else window.history.pushState({}, '', normalized)
    }

    setRoute(parseAppRoute(normalized))
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])

  const navigate = useCallback((page: AppPage, replace = false) => {
    navigatePath(PAGE_PATHS[page], replace)
  }, [navigatePath])

  const navigateLead = useCallback((publicId: string | number, replace = false) => {
    navigatePath(leadPath(publicId), replace)
  }, [navigatePath])

  return {
    route,
    navigate,
    navigateLead,
    navigatePath,
  }
}
