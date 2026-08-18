import { supabase } from './supabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

function responseMessage(body: string, fallback: string) {
  if (!body) return fallback
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string }
    return parsed.error || parsed.message || fallback
  } catch {
    return body.slice(0, 180) || fallback
  }
}

export async function invokeSecureAutomation(
  functionName: 'crm-lead-intake' | 'crm-status-route',
  body: Record<string, unknown> | FormData,
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
  }

  if (!isForm) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers,
    body: isForm ? body : JSON.stringify(body),
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(responseMessage(text, `Automation gateway returned ${response.status}.`))
  }

  return text
}
