import { test, expect } from '@playwright/test'

// The case-study page only renders for a featured Showcase item with case-study
// content. No real item has one in the committed fallback, so the test build
// serves two fixtures (src/components/site/portfolio/caseStudyFixture.ts).

test.describe('portfolio case studies', () => {
  test('a featured item renders its case study', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(e.message))

    const res = await page.goto('/portfolio/fixture-case-study', { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Fixture Plumbing Co.')
    await expect(page.getByText('In their words')).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('a private app shows the demo note instead of a live link', async ({ page }) => {
    const res = await page.goto('/portfolio/fixture-private-app', { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)
    await expect(page.getByText('Private app. Demo on request.')).toBeVisible()
  })

  test('an item without a case study is a 404', async ({ page }) => {
    const res = await page.goto('/portfolio/hike-wales', { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(404)
  })
})
