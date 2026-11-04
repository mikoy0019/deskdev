import { test, expect, type Page } from '@playwright/test'
import { hydrated } from './helpers'

// The footer sign-up is on every page: its invalid paths, what it says when
// the server cannot take the address, and what a visitor sees when it works.

async function footerForm(page: Page) {
  await page.goto('/')
  const email = page.locator('#footer-email')
  await hydrated(page, '#footer-email')
  await email.scrollIntoViewIfNeeded()
  return { email, consent: page.locator('#footer-consent'), submit: page.getByRole('button', { name: 'Subscribe' }) }
}

async function tick(page: Page) {
  await page.locator('#footer-consent').focus()
  await page.keyboard.press('Space')
  await expect(page.locator('#footer-consent')).toBeChecked()
}

test.describe('footer sign-up', () => {
  test('explains an empty address, a mistyped one and a missing tick', async ({ page }) => {
    const posts: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/subscribe')) posts.push(r.url())
    })
    const { email, submit } = await footerForm(page)

    await submit.click()
    await expect(page.getByText('Enter your email address to subscribe.')).toBeVisible()
    await expect(email).toBeFocused()

    await email.fill('not-an-email')
    await submit.click()
    await expect(page.getByText('Enter a full email address, like name@company.com.')).toBeVisible()

    await email.fill('e2e-subscriber@example.com')
    await submit.click()
    await expect(page.getByText('Tick the box to subscribe.')).toBeVisible()

    expect(posts).toEqual([])
  })

  test('says so when the server cannot take the address, instead of pretending', async ({ page }) => {
    const { email, submit } = await footerForm(page)
    await email.fill('e2e-subscriber@example.com')
    await tick(page)

    // The real route answers: this build has no backend.
    const [answer] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/subscribe') && r.request().method() === 'POST'),
      submit.click(),
    ])
    expect(answer.status()).toBe(503)
    await expect(page.getByRole('alert').filter({ hasText: 'Subscriptions are not available right now.' })).toBeVisible()
    await expect(page.getByText('Subscribed. Welcome aboard.')).toHaveCount(0)
  })

  test('confirms a sign-up the server accepted', async ({ page }) => {
    // The database side is proven against the deployed site; here the route's
    // own success answer is replayed to film what a visitor sees.
    await page.route('**/api/subscribe', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }),
    )
    const { email, submit } = await footerForm(page)
    await email.fill('e2e-subscriber@example.com')
    await tick(page)
    await submit.click()

    await expect(page.getByRole('status').filter({ hasText: 'Subscribed. Welcome aboard.' })).toBeVisible()
  })
})
