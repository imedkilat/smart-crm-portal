import { expect, test } from '@playwright/test'

const email = process.env.E2E_PRIMARY_EMAIL?.trim()
const password = process.env.E2E_PRIMARY_PASSWORD
const supabaseConfigured = Boolean(
  process.env.VITE_SUPABASE_URL?.trim() && process.env.VITE_SUPABASE_ANON_KEY?.trim(),
)
const hasCredentials = Boolean(email && password && (process.env.E2E_BASE_URL || supabaseConfigured))

test.describe('credential-gated protected-route smoke', () => {
  test.skip(!hasCredentials, 'Set E2E_PRIMARY_EMAIL/E2E_PRIMARY_PASSWORD and either E2E_BASE_URL or local Supabase env vars.')

  test('existing QA user can sign in and read core protected surfaces without writes', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email address').fill(email!)
    await page.getByLabel('Password', { exact: true }).fill(password!)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 })
    await expect(page).toHaveTitle(/Dashboard · Smart CRM/)

    await page.goto('/quotes')
    await expect(page).toHaveURL(/\/quotes$/)
    await expect(page.getByRole('heading', { name: 'Quote lifecycle' })).toBeVisible()
    await expect(page.getByText('Safe lifecycle mode')).toBeVisible()

    await page.goto('/ai-brain')
    await expect(page).toHaveURL(/\/ai-brain$/)
    await expect(page).toHaveTitle(/AI Brain · Smart CRM/)
  })
})
