import { expect, test, type Page } from '@playwright/test'

async function openOperations(page: Page) {
  await page.goto('/workspace/login')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.locator('#login-email').fill('admin@deskdev.local')
  await page.locator('#login-password').fill('admin')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
  // Keep the scenario deterministic and include an unresolved delivery exception.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('deskdev-store')!)
    const state = saved.state
    const project = state.projects.find((p: { id: string }) => p.id === 'pr-portal')
    state.tasks = [{ id: 'cube-auto-task', clientId: project.clientId, projectId: project.id, title: 'Automatic blocker', status: 'blocked', priority: 'high', position: 0, archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
    state.leads = []
    state.projectEngagements = []
    localStorage.removeItem('deskdev-cube-operations:v1:local')
    localStorage.setItem('deskdev-store', JSON.stringify(saved))
  })
  await page.goto('/workspace/cube')
  await page.getByRole('button', { name: 'Operations', exact: true }).click()
  await expect(page.getByText('Automatic routing on', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Code with Toushif/ })).toHaveAttribute('href', 'https://www.facebook.com/share/14r1nrEN5fG/?mibextid=wwXIfr')
}

test('automatically routes all department queues, preserves contract holds, and saves evidence-backed intake', async ({ page }, testInfo) => {
  await openOperations(page)
  const operations = page.getByLabel('Cube automatic operations', { exact: true })
  const finance = operations.getByRole('article', { name: 'Finance: Client portal redesign', exact: true })
  const delivery = operations.getByRole('article', { name: 'Delivery / Engineering: Automatic blocker', exact: true })
  await expect(finance).toContainText('Contract pending')
  await expect(delivery).toBeVisible()
  await expect(operations.getByRole('combobox', { name: /admin$/ })).toHaveCount(7)
  await operations.getByRole('button', { name: 'Evaluate now', exact: true }).click()
  await expect(delivery).toHaveCount(1)
  await operations.getByRole('combobox', { name: 'Project', exact: true }).selectOption('pr-portal')
  await operations.getByRole('checkbox', { name: 'Brief confirmed', exact: true }).check()
  await operations.getByRole('button', { name: 'Save project intake', exact: true }).click()
  await expect(operations.getByRole('alert')).toContainText('Confirmations require evidence')
  await operations.getByRole('textbox', { name: 'Contract reference', exact: true }).fill('Contract file pending owner upload')
  await operations.getByRole('textbox', { name: 'Confirmation evidence', exact: true }).fill('Brief B-1 and client asset folder A-1')
  await operations.getByRole('checkbox', { name: 'Assets confirmed', exact: true }).check()
  await operations.getByRole('checkbox', { name: 'Creative review required', exact: true }).check()
  await operations.getByRole('button', { name: 'Save project intake', exact: true }).click()
  await expect(operations.getByRole('article', { name: 'Client Operations: Client portal redesign', exact: true })).toHaveCount(0)
  await expect(operations.getByRole('article', { name: 'Creative / Content: Client portal redesign', exact: true })).toBeVisible()
  await expect(finance).toContainText('record scope, acceptance and deposit evidence')
  await page.reload()
  await page.getByRole('button', { name: 'Operations', exact: true }).click()
  await operations.getByRole('combobox', { name: 'Project', exact: true }).selectOption('pr-portal')
  await expect(operations.getByRole('textbox', { name: 'Contract reference', exact: true })).toHaveValue('Contract file pending owner upload')
  await expect(operations.getByRole('checkbox', { name: 'Brief confirmed', exact: true })).toBeChecked()
  await page.screenshot({ path: testInfo.outputPath('cube-operations-desktop.png'), fullPage: true })
  await operations.getByRole('heading', { name: 'Automatic operations', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('cube-operations-board-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('cube-operations-mobile.png'), fullPage: true })
  await operations.getByRole('heading', { name: 'Client Operations', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('cube-departments-mobile.png') })
})

test('workspace pause persists and member accounts cannot operate or view the admin queues', async ({ page }) => {
  await openOperations(page)
  const operations = page.getByLabel('Cube automatic operations', { exact: true })
  await operations.getByRole('button', { name: 'Pause all operations', exact: true }).click()
  await expect(operations.getByText('Paused', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Operations', exact: true }).click()
  await expect(operations.getByText('Paused', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('deskdev-store')!)
    const user = saved.state.users.find((u: { id: string }) => u.id === saved.state.currentUserId)
    user.role = 'member'
    localStorage.setItem('deskdev-store', JSON.stringify(saved))
  })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Operations', exact: true })).toHaveCount(0)
  await expect(operations).toHaveCount(0)
})

test('automation evaluates source changes on other DeskDev screens', async ({ page }) => {
  await openOperations(page)
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('deskdev-store')!)
    saved.state.tasks[0].status = 'done'
    localStorage.setItem('deskdev-store', JSON.stringify(saved))
  })
  await page.goto('/workspace/tasks')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('deskdev-cube-operations:v1:local')!).work.find((w: { key: string }) => w.key === 'delivery:task:cube-auto-task')?.status)).toBe('resolved')
  await page.goto('/workspace/cube')
  await page.getByRole('button', { name: 'Operations', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Include resolved work', exact: true }).check()
  await expect(page.getByRole('article', { name: 'Delivery / Engineering: Automatic blocker', exact: true })).toContainText('resolved')
})

test('unreadable operations storage remains intact and automation controls are disabled', async ({ page }) => {
  await openOperations(page)
  await page.evaluate(() => localStorage.setItem('deskdev-cube-operations:v1:local','{broken'))
  await page.reload()
  await page.getByRole('button', { name: 'Operations', exact: true }).click()
  const operations = page.getByLabel('Cube automatic operations', { exact: true })
  await expect(operations.getByRole('alert')).toBeVisible()
  await expect(operations.getByRole('button', { name: 'Evaluate now', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => localStorage.getItem('deskdev-cube-operations:v1:local'))).toBe('{broken')
})
