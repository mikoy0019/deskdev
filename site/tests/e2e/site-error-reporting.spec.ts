import { test, expect, type Page, type Request } from '@playwright/test'

// Errors in a visitor's browser are reported to /api/client-errors and end up
// in the Worker's logs (src/lib/clientErrors.ts). This films the wiring on the
// marketing site and in DeskDev: one uncaught error, one report, no personal
// data in it, and the page still works afterwards.

const isReport = (r: Request) => r.method() === 'POST' && r.url().includes('/api/client-errors')

/**
 * Raises the error until a report leaves. The listeners are installed once
 * the page is interactive, a moment after it is visible, and an error raised
 * before that is nobody's to report. The reporter sends one error once, so
 * the tries before the listeners exist cost nothing and exactly one report
 * comes out.
 */
async function reportOf(page: Page, raise: () => Promise<void>) {
  let request: Request | undefined
  await expect(async () => {
    const waiting = page.waitForRequest(isReport, { timeout: 1500 })
    await raise()
    request = await waiting
  }).toPass({ timeout: 30_000 })
  const response = await request!.response()
  return {
    status: response?.status(),
    body: JSON.parse(request!.postData() ?? '{}') as Record<string, unknown>,
    raw: request!.postData() ?? '',
  }
}

const throwLater = (page: Page, message: string) =>
  page.evaluate((m) => {
    setTimeout(() => {
      throw new Error(m)
    }, 0)
  }, message)

test.describe('browser error reporting', () => {
  test('an uncaught error on the site is reported once, without the query string', async ({ page }) => {
    await page.goto('/services?utm_source=e2e&email=someone@example.com#section')

    const report = await reportOf(page, () => throwLater(page, 'E2E probe: site error'))
    expect(report.status).toBe(204)
    expect(report.body).toMatchObject({ app: 'site', kind: 'error', name: 'Error', path: '/services' })
    expect(report.raw).not.toContain('utm_source')
    expect(report.raw).not.toContain('someone@example.com')

    // The same error again is not sent twice.
    let repeats = 0
    page.on('request', (r) => {
      if (isReport(r)) repeats++
    })
    await throwLater(page, 'E2E probe: site error')
    await page.waitForTimeout(800)
    expect(repeats).toBe(0)

    // And the page carries on.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.getByRole('navigation', { name: 'Primary' }).first().getByRole('link', { name: 'About', exact: true }).click()
    await expect(page).toHaveURL(/\/about$/)
  })

  test('a failed promise in DeskDev is reported as coming from the workspace', async ({ page }) => {
    await page.goto('/workspace/tasks')
    await expect(page).not.toHaveURL(/\/login$/)

    const report = await reportOf(page, () =>
      page.evaluate(() => {
        void Promise.reject(new TypeError('E2E probe: workspace rejection'))
      }),
    )
    expect(report.status).toBe(204)
    expect(report.body).toMatchObject({ app: 'workspace', kind: 'unhandledrejection', name: 'TypeError' })
    expect(String(report.body.path)).toContain('/tasks')

    // DeskDev is still usable.
    await page.goto('/workspace/projects')
    await expect(page).not.toHaveURL(/\/login$/)
    await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible()
  })
})
