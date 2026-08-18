import { supabase } from './supabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

type SecureFunctionName = 'crm-lead-intake' | 'crm-status-route' | 'crm-ai-copilot'

type InvokeOptions = {
  workspaceId?: string | null
  idempotencyKey?: string
}

function responseMessage(body: string, fallback: string) {
  if (!body) return fallback
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string }
    return parsed.error || parsed.message || fallback
  } catch {
    return body.slice(0, 180) || fallback
  }
}

function automaticIdempotencyKey(functionName: SecureFunctionName, body: Record<string, unknown> | FormData) {
  if (!(body instanceof FormData)) {
    if (functionName === 'crm-status-route') {
      const eventId = body.event_id
      if (typeof eventId === 'string' && eventId.trim()) return eventId.trim()
    }

    if (functionName === 'crm-ai-copilot') {
      const requestId = body.request_id
      if (typeof requestId === 'string' && requestId.trim()) return requestId.trim()
    }
  }

  return `${functionName}:${crypto.randomUUID()}`
}

export async function invokeSecureAutomation(
  functionName: SecureFunctionName,
  body: Record<string, unknown> | FormData,
  options: InvokeOptions = {},
) {
  if (!supabase || !supabaseUrl || !supabasePublishableKey) {
    throw new Error('Secure automation gateway is not configured.')
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError || !session?.access_token) {
    throw new Error('Your session expired. Sign in again before running automation.')
  }

  const isForm = body instanceof FormData
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.access_token}`,
    apikey: supabasePublishableKey,
    'X-Idempotency-Key': options.idempotencyKey || automaticIdempotencyKey(functionName, body),
  }

  if (options.workspaceId) headers['X-Workspace-Id'] = options.workspaceId
  if (!isForm) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers,
    body: isForm ? body : JSON.stringify(body),
  })

  const text = await response.text()
  if (!response.ok) {
    const retryAfter = response.headers.get('Retry-After')
    const suffix = response.status === 429 && retryAfter ? ` Try again in ${retryAfter}s.` : ''
    throw new Error(`${responseMessage(text, `Automation gateway returned ${response.status}.`)}${suffix}`)
  }

  return text
}
