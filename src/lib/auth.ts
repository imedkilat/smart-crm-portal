import { supabase, isSupabaseConfigured } from './supabase'

export type AuthResult = { ok: true } | { ok: false; message: string }
export type SignUpResult =
  | { ok: true; confirmationRequired: boolean }
  | { ok: false; message: string }

function friendlyError(message: string) {
  const value = message.toLowerCase()

  if (value.includes('invalid login')) {
    return 'That email and password combination does not match an account.'
  }

  if (value.includes('email not confirmed')) {
    return 'Confirm your email address before signing in.'
  }

  if (value.includes('already registered') || value.includes('already exists')) {
    return 'An account may already exist for that email. Try signing in or reset your password.'
  }

  if (value.includes('password') && (value.includes('weak') || value.includes('characters'))) {
    return 'Choose a stronger password with at least 8 characters.'
  }

  if (value.includes('rate') || value.includes('too many')) {
    return 'Too many attempts. Try again in a few minutes.'
  }

  if (value.includes('session')) {
    return 'Your recovery session is no longer valid. Request a new password reset link.'
  }

  return message
}

function unavailable() {
  return { ok: false, message: 'Supabase authentication is not configured for this environment yet.' } as const
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (!isSupabaseConfigured || !supabase) return unavailable()

  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })

  return error ? { ok: false, message: friendlyError(error.message) } : { ok: true }
}

export async function signUp(email: string, password: string, workspaceName: string): Promise<SignUpResult> {
  if (!isSupabaseConfigured || !supabase) return unavailable()

  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: {
        workspace_name: workspaceName.trim(),
      },
      emailRedirectTo: `${window.location.origin}/login`,
    },
  })

  if (error) return { ok: false, message: friendlyError(error.message) }

  return {
    ok: true,
    confirmationRequired: !data.session,
  }
}

export async function sendPasswordReset(email: string): Promise<AuthResult> {
  if (!isSupabaseConfigured || !supabase) return unavailable()

  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/reset-password`,
  })

  return error ? { ok: false, message: friendlyError(error.message) } : { ok: true }
}

export async function updatePassword(password: string): Promise<AuthResult> {
  if (!isSupabaseConfigured || !supabase) return unavailable()

  const { error } = await supabase.auth.updateUser({ password })
  return error ? { ok: false, message: friendlyError(error.message) } : { ok: true }
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut()
}
