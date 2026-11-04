import { test, expect, type Page } from '@playwright/test'
import { hydrated } from './helpers'

// Lead capture is what the site exists to do (e2e_video_proof §3.4), so the
// brief form is filmed on its invalid path and on both ways a valid brief ends.
//
// The form has a safety net: when /api/contact says the lead may not have
// landed, the brief is emailed through formsubmit.co. That call is always
// answered here, never sent: a test must not put mail in a real inbox.

const FORMSUBMIT = 'https://formsubmit.co/**'

async function stubMailbox(page: Page) {
  const sent: string[] = []
  await page.route(FORMSUBMIT, async (route) => {
    sent.push(route.request().postData() ?? '')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: 'true' }) })
  })
  return sent
}

async function fillBrief(page: Page, email = 'e2e-brief@example.com') {
  await page.locator('#name').fill('E2E Test Visitor')
  await page.locator('#email').fill(email)
  await page.locator('#company').fill('Example Plumbing Co.')
  await page.locator('#message').fill('This is an automated end-to-end test of the project brief form. Please ignore it.')
  // One choice in each picker, the way a visitor taps them.
  for (const group of ['system-label', 'budget-label', 'timeline-label']) {
    await page.locator(`[role="radiogroup"][aria-labelledby="${group}"] [role="radio"]`).first().click()
  }
  // The tick is the consent: set it from the keyboard, as the control is custom-drawn.
  await page.locator('#consent').focus()
  await page.keyboard.press('Space')
  await expect(page.locator('#consent')).toBeChecked()
}

const send = (page: Page) => page.getByRole('button', { name: /send project brief/i })

/** Opens the contact page and waits until the brief form answers to clicks. */
async function openBrief(page: Page) {
  await page.goto('/contact')
  await hydrated(page, 'form[aria-labelledby="brief-title"]')
}

test.describe('project brief form', () => {
  test('an empty brief is explained field by field and nothing is sent', async ({ page }) => {
    const mailbox = await stubMailbox(page)
    const posts: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/contact')) posts.push(r.url())
    })

    await openBrief(page)
    await send(page).click()

    for (const id of ['name-error', 'email-error', 'message-error', 'consent-error']) {
      await expect(page.locator(`#${id}`), id).toBeVisible()
    }
    // Focus lands on the first thing to fix.
    await expect(page.locator('#name')).toBeFocused()
    expect(posts).toEqual([])
    expect(mailbox).toEqual([])
  })

  test('a mistyped email is caught before sending', async ({ page }) => {
    await stubMailbox(page)
    await openBrief(page)
    await fillBrief(page, 'not-an-email')
    await send(page).click()

    await expect(page.locator('#email-error')).toBeVisible()
    await expect(page.locator('#email')).toBeFocused()
    await expect(page.getByText(/we'll be in touch/i)).toHaveCount(0)
  })

  test('a brief the database cannot take is emailed instead of lost', async ({ page }) => {
    const mailbox = await stubMailbox(page)
    await openBrief(page)
    await fillBrief(page)

    // The real route answers: this build has no backend, so it says the lead
    // was not recorded and asks the form to fall back to email.
    const [answer] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/contact') && r.request().method() === 'POST'),
      send(page).click(),
    ])
    expect(answer.status()).toBe(503)
    expect(await answer.json()).toMatchObject({ success: false, lead: 'failed', fallback: true })
    expect(answer.headers()['x-request-id']).toBeTruthy()

    await expect(page.getByRole('heading', { name: /thank you/i })).toBeVisible()
    expect(mailbox).toHaveLength(1)
    // The email says the lead is missing from DeskDev, so it is added by hand.
    expect(mailbox[0]).toContain('NOT recorded in DeskDev')
    expect(mailbox[0]).toContain('E2E Test Visitor')
  })

  test('a recorded brief ends on the confirmation and sends no email', async ({ page }) => {
    const mailbox = await stubMailbox(page)
    // The database side of this path is proven against the deployed site; here
    // the route's own "recorded" answer is replayed to film what a visitor sees.
    await page.route('**/api/contact', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, lead: 'recorded', fallback: false }),
      })
    })

    await openBrief(page)
    await fillBrief(page)
    await send(page).click()

    await expect(page.getByRole('heading', { name: /thank you/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /back to home/i })).toBeVisible()
    expect(mailbox).toEqual([])
  })

  test('a refusal the visitor can act on is shown, and the brief is not emailed', async ({ page }) => {
    const mailbox = await stubMailbox(page)
    await page.route('**/api/contact', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        headers: { 'Retry-After': '600' },
        body: JSON.stringify({ success: false, lead: 'throttled', fallback: false, error: 'Too many briefs from here. Please try again in a few minutes.' }),
      })
    })

    await openBrief(page)
    await fillBrief(page)
    await send(page).click()

    await expect(page.getByRole('alert').filter({ hasText: 'Too many briefs from here' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /thank you/i })).toHaveCount(0)
    expect(mailbox).toEqual([])
  })
})
