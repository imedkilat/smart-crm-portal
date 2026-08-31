import { expect, test } from '@playwright/test'

test.describe('public auth regression', () => {
  test('protected routes redirect unauthenticated users to sign in', async ({ page }) => {
    for (const path of ['/dashboard', '/quotes', '/ai-brain']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login$/)
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    }
  })

  test('sign-in form keeps required-field validation', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByText('Enter your email address.')).toBeVisible()
    await expect(page.getByText('Enter your password.')).toBeVisible()
  })

  test('workspace signup requires identity and workspace fields before any network call', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Create your workspace' }).click()
    await expect(page.getByRole('heading', { name: 'Start your Smart CRM' })).toBeVisible()
    await expect(page.getByLabel('Full name')).toBeVisible()
    await expect(page.getByLabel('Workspace name')).toBeVisible()
    await expect(page.getByLabel('Email address')).toBeVisible()
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Confirm password')).toBeVisible()
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('Enter your full name.')).toBeVisible()
    await expect(page.getByText('Enter a workspace name with at least 2 characters.')).toBeVisible()
    await expect(page.getByText('Enter your email address.')).toBeVisible()
    await expect(page.getByText('Enter a password.')).toBeVisible()
  })

  test('password recovery entry stays reachable from sign in', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Forgot password?' }).click()
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Back to sign in/ })).toBeVisible()
  })
})
