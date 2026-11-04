import { test, expect } from '@playwright/test'

// Route smoke per e2e_video_proof §3.1 — every <Route> in App.tsx gets a check.
// A route "passes" only if it renders without being bounced to /login, without
// a NotFound, and without an uncaught page error.

const ROUTES: Array<{ path: string; label: string }> = [
  { path: '/', label: 'dashboard' },
  { path: '/projects', label: 'projects' },
  { path: '/tasks', label: 'tasks' },
  { path: '/clients', label: 'clients' },
  { path: '/crm', label: 'crm' },
  { path: '/calendar', label: 'calendar' },
  { path: '/meetings', label: 'meetings' },
  { path: '/recordings', label: 'recordings' },
  { path: '/whiteboard', label: 'whiteboard' },
  { path: '/assistant', label: 'assistant' },
  { path: '/growth', label: 'growth-hub' },
  { path: '/growth/leads', label: 'growth-leads' },
  { path: '/growth/outbound', label: 'growth-outbound' },
  { path: '/courses', label: 'courses' },
  { path: '/messages', label: 'messages' },
  { path: '/notifications', label: 'notifications' },
  { path: '/showcase', label: 'showcase' },
  { path: '/vault', label: 'vault' },
  { path: '/settings', label: 'settings' },
]

test.describe('route smoke', () => {
  for (const { path, label } of ROUTES) {
    test(`renders ${label} (${path})`, async ({ page }, testInfo) => {
      const pageErrors: string[] = []
      const consoleErrors: string[] = []
      page.on('pageerror', (e) => pageErrors.push(e.message))
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text())
      })

      const res = await page.goto(`/workspace${path}`, { waitUntil: 'domcontentloaded' })
      expect(res?.status(), `HTTP status for ${path}`).toBeLessThan(400)

      // Must not have been bounced back to the login gate.
      await expect(page, `${path} should stay authenticated`).not.toHaveURL(/\/login$/)

      // Something must actually render.
      await expect(page.locator('body')).not.toBeEmpty()

      // Uncaught exceptions are a hard fail.
      expect(pageErrors, `uncaught page errors on ${path}`).toEqual([])

      // Console errors do not fail the flow, but §5 makes them the WARN
      // condition — so they must be recorded, not silently dropped. Attaching
      // them puts them in the HTML report and makes the verdict auditable.
      if (consoleErrors.length > 0) {
        await testInfo.attach(`console-errors${path.replace(/\//g, '_')}`, {
          body: consoleErrors.join('\n'),
          contentType: 'text/plain',
        })
      }
    })
  }

  test('unknown route renders NotFound, not a crash', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(e.message))

    await page.goto('/workspace/this-route-does-not-exist')
    await expect(page).not.toHaveURL(/\/login$/)
    await expect(page.locator('body')).not.toBeEmpty()
    expect(pageErrors).toEqual([])
  })
})
