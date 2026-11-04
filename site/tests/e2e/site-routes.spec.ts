import { test, expect } from '@playwright/test'

// The marketing site, per e2e_video_proof §3.1: every public route gets a
// smoke check, and so do the things a crawler or a monitor reads. DeskDev's
// own routes are in routes.spec.ts.

const PAGES: Array<{ path: string; label: string }> = [
  { path: '/', label: 'home' },
  { path: '/services', label: 'services' },
  { path: '/about', label: 'about' },
  { path: '/portfolio', label: 'portfolio' },
  { path: '/process', label: 'process' },
  { path: '/contact', label: 'contact' },
  { path: '/templates', label: 'templates' },
  { path: '/privacy', label: 'privacy' },
  { path: '/terms', label: 'terms' },
  { path: '/login', label: 'team-login' },
]

test.describe('site route smoke', () => {
  for (const { path, label } of PAGES) {
    test(`renders ${label} (${path})`, async ({ page }, testInfo) => {
      const pageErrors: string[] = []
      const consoleErrors: string[] = []
      page.on('pageerror', (e) => pageErrors.push(e.message))
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text())
      })

      const res = await page.goto(path, { waitUntil: 'domcontentloaded' })
      expect(res?.status(), `HTTP status for ${path}`).toBe(200)

      // A real page: one main heading and a title of its own.
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      expect(await page.title()).not.toBe('')

      // Scroll the whole page once, so the film shows it and lazy sections mount.
      await page.evaluate(async () => {
        const step = Math.max(400, Math.floor(window.innerHeight * 0.9))
        for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
          window.scrollTo(0, y)
          await new Promise((r) => setTimeout(r, 60))
        }
        window.scrollTo(0, 0)
      })

      expect(pageErrors, `uncaught page errors on ${path}`).toEqual([])

      // Console errors are the WARN condition (§5): recorded, never dropped.
      if (consoleErrors.length > 0) {
        await testInfo.attach(`console-errors-${label}`, {
          body: consoleErrors.join('\n'),
          contentType: 'text/plain',
        })
      }
    })
  }

  test('an unknown page is a designed 404 with a way home', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(e.message))

    const res = await page.goto('/this-page-does-not-exist', { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await page.getByRole('link', { name: /back to home/i }).click()
    await expect(page).toHaveURL(/localhost:4173\/$/)
    expect(pageErrors).toEqual([])
  })

  test('the header takes a visitor to each main page', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' }).first()
    for (const [name, url] of [
      ['Work', /\/portfolio$/],
      ['Services', /\/services$/],
      ['Templates', /\/templates$/],
      ['About', /\/about$/],
    ] as const) {
      // The bar tucks away on scroll; start each hop from the top.
      await page.evaluate(() => window.scrollTo(0, 0))
      await nav.getByRole('link', { name, exact: true }).click()
      await expect(page).toHaveURL(url)
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    }
  })

  test('the team login page hands over to DeskDev sign-in', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // This build has no backend (see playwright.config.ts), so the page offers
    // DeskDev's own sign-in instead of the password form.
    const direct = page.locator('a[href*="/login?direct=1"]').first()
    if (await direct.count()) {
      await direct.click()
      // The link leaves the marketing site for DeskDev. This browser is the
      // signed-in admin (auth.setup.ts), so DeskDev opens the workspace; a
      // signed-out visitor gets its sign-in form, which auth.spec.ts covers.
      await expect(page).toHaveURL(/\/workspace(\/|\?|$)/)
      await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible()
    } else {
      await expect(page.locator('#email')).toBeVisible()
      await expect(page.locator('#password')).toBeVisible()
    }
  })
})

// Each of these opens the address in the browser, so the film shows what a
// crawler or a monitor is given (e2e_video_proof: a flow without a recording
// is not proof).
test.describe('what crawlers and monitors read', () => {
  test('a build that is not on the production domain tells search engines to stay out', async ({ page }) => {
    const robots = await page.goto('/robots.txt')
    expect(robots?.status()).toBe(200)
    const text = (await robots?.text()) ?? ''
    expect(text).toMatch(/User-Agent: \*/i)
    expect(text).toMatch(/^Disallow: \/$/m)
    expect(text).not.toMatch(/Sitemap:/i)
    await expect(page.getByText('Disallow: /')).toBeVisible()

    const home = await page.goto('/')
    expect(home?.headers()['x-robots-tag']).toBe('noindex, nofollow')
  })

  test('pages carry the security headers', async ({ page }) => {
    for (const path of ['/', '/workspace', '/contact']) {
      const headers = (await page.goto(path, { waitUntil: 'domcontentloaded' }))?.headers() ?? {}
      expect(headers['x-content-type-options'], path).toBe('nosniff')
      expect(headers['x-frame-options'], path).toBe('DENY')
      expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'")
      expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin')
    }
  })

  test('the health endpoint answers, with and without the database check', async ({ page }) => {
    const plain = await page.goto('/api/health')
    expect(plain?.status()).toBe(200)
    expect(plain?.headers()['cache-control']).toContain('no-store')
    expect(plain?.headers()['x-request-id']).toBeTruthy()
    const body = await plain?.json()
    expect(body.ok).toBe(true)
    expect(body.service).toBe('nixgen-site')
    expect(Number.isNaN(Date.parse(body.time))).toBe(false)

    // No backend in this build: the check says so, and that is not a failure.
    const deep = await page.goto('/api/health?deep=1')
    expect(deep?.status()).toBe(200)
    expect((await deep?.json()).checks?.database).toBe('unconfigured')
    await expect(page.getByText('unconfigured')).toBeVisible()
  })

  test('an /api answer no route handler writes still carries a request id', async ({ page }) => {
    // The framework answers these itself; src/proxy.ts is what puts the id on them.
    const cases: Array<[method: string, path: string, status: number]> = [
      ['PATCH', '/api/health', 405],
      ['PUT', '/api/contact', 405],
      ['GET', '/api/subscribe', 405],
      ['OPTIONS', '/api/contact', 204],
      ['GET', '/api/does-not-exist', 404],
    ]
    // Asked from a page of the site, the way a browser would.
    const health = await page.goto('/api/health')
    const answers = await page.evaluate(async (list) => {
      const out: Array<{ status: number; id: string | null }> = []
      for (const [method, path] of list) {
        const res = await fetch(path, { method })
        out.push({ status: res.status, id: res.headers.get('x-request-id') })
      }
      return out
    }, cases.map(([method, path]) => [method, path] as [string, string]))

    const ids = new Set<string>()
    cases.forEach(([method, path, status], i) => {
      expect(answers[i].status, method + ' ' + path).toBe(status)
      const id = answers[i].id ?? ''
      expect(id, method + ' ' + path).toMatch(/^[0-9a-f-]{8,}/i)
      // One value, not the proxy's and a handler's joined together.
      expect(id, method + ' ' + path).not.toContain(',')
      ids.add(id)
    })
    expect(ids.size).toBe(cases.length)

    // A handler's own answer has exactly one id as well.
    expect(health?.headers()['x-request-id']).toMatch(/^[0-9a-f-]{8,}$/i)
  })

  test('the sitemap lists the public pages and nothing from the workspace', async ({ page }) => {
    const res = await page.goto('/sitemap.xml')
    expect(res?.status()).toBe(200)
    const xml = (await res?.text()) ?? ''
    for (const path of ['/services', '/portfolio', '/contact', '/privacy']) expect(xml, path).toContain(path + '</loc>')
    expect(xml).not.toContain('/workspace')
    expect(xml).not.toContain('/login')
  })
})
