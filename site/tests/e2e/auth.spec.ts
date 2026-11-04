import { test, expect } from '@playwright/test'

// Run these unauthenticated — the invalid-input path is required by
// e2e_video_proof §3.2 (happy path AND one invalid path per form).
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('authentication', () => {
  test('rejects invalid credentials without navigating away', async ({ page }) => {
    await page.goto('/workspace/login')

    await page.locator('#login-email').fill('admin@deskdev.local')
    await page.locator('#login-password').fill('definitely-not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    // An error must surface, and we must still be on /login.
    // Next.js's route announcer is a role="alert" too, and empty: skip it.
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/\/login$/)
  })

  test('gates a protected route behind sign-in', async ({ page }) => {
    await page.goto('/workspace/projects')

    // Unauthenticated access to a gated route must not render the route.
    await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 })
    await expect(page.locator('#login-email')).toBeVisible()
  })
})
