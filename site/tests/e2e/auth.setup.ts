import { test as setup, expect } from '@playwright/test'

const STATE = 'e2e-artifacts/state.json'

// Auth is mandatory and runs first (e2e_video_proof §3.3). Every other flow
// reuses the storage state this produces. In LOCAL mode the session lives in
// localStorage, which storageState() captures per-origin.
setup('sign in with the admin demo account', async ({ page }) => {
  await page.goto('/workspace/login')

  await expect(page.getByRole('heading', { name: 'Sign in to DeskDev' })).toBeVisible()

  // The demo-accounts panel is the app's own documentation of these creds.
  await expect(page.getByText('admin@deskdev.local')).toBeVisible()

  await page.locator('#login-email').fill('admin@deskdev.local')
  await page.locator('#login-password').fill('admin')
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Successful sign-in navigates to the dashboard root.
  await expect(page).toHaveURL(/localhost:4173\/workspace$/, { timeout: 20_000 })
  await expect(page.locator('#login-email')).toHaveCount(0)

  await page.context().storageState({ path: STATE })
})
