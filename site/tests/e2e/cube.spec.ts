import { expect, test, type Page } from '@playwright/test'

async function signInAndSeed(page: Page) {
  await page.goto('/workspace/login')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.locator('#login-email').fill('admin@deskdev.local')
  await page.locator('#login-password').fill('admin')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('deskdev-store')!)
    const state = saved.state
    const project = state.projects.find((item: { id: string }) => item.id === 'pr-portal')
    const stamp = new Date().toISOString()
    state.leads = [{ id: 'cube-lead', name: 'Cube prospect', stage: 'new', source: 'website', value: 0, hot: false, ownerId: state.currentUserId, followUp: '2026-01-01', createdAt: stamp, updatedAt: stamp }]
    state.tasks = [{ id: 'cube-task', clientId: project.clientId, projectId: project.id, title: 'Cube blocker', status: 'blocked', priority: 'high', dueDate: '2026-01-01', assigneeId: state.currentUserId, notes: 'Waiting for approved assets', position: 0, archived: false, createdAt: stamp, updatedAt: stamp }]
    state.projectEngagements = [{ id: 'cube-engagement', projectId: project.id, version: 1, terms: { currency: 'USD', feeMinor: 100000, depositMinor: 25000, scope: 'Client portal', acceptedOn: '2026-01-01', acceptanceEvidence: 'Signed agreement', phase: 'planning', milestones: [], invoices: [], payments: [] }, createdAt: stamp, updatedAt: stamp }]
    localStorage.setItem('deskdev-store', JSON.stringify(saved))
  })
  await page.goto('/workspace/cube')
}

test('Cube reviews persist, source links work, and finance follows the existing gate', async ({ page }, testInfo) => {
  await signInAndSeed(page)
  await expect(page.getByRole('heading', { name: 'Cube', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('cube-desktop.png'), fullPage: true })
  const blocker = page.getByRole('article', { name: 'Cube blocker' })
  await blocker.getByText('Evidence and matched rules').click()
  await expect(blocker.getByText('Waiting for approved assets')).toBeVisible()
  await expect(blocker.getByRole('link', { name: 'Open record' })).toHaveAttribute('href', '/workspace/tasks?task=cube-task')
  await blocker.getByRole('button', { name: 'Acknowledge', exact: true }).click()
  await expect(blocker).toHaveCount(0)
  await page.reload()
  await expect(blocker).toHaveCount(0)
  await page.getByLabel('Review status').selectOption('all')
  await expect(blocker.getByText('Acknowledged', { exact: true })).toBeVisible()
  await blocker.getByRole('button', { name: 'Reopen review' }).click()
  await blocker.getByRole('button', { name: 'Snooze 24 hours' }).click()
  await expect(blocker.getByText('Snoozed', { exact: true })).toBeVisible()
  const finance = page.getByRole('article', { name: 'Client portal redesign' })
  await expect(finance).toContainText('Record the agreed deposit before kickoff.')
  await page.getByRole('button', { name: 'Review history', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Personal review history' })).toContainText('Snoozed for 24 hours')
  await page.getByRole('button', { name: 'Playbooks', exact: true }).click()
  const playbook = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Blocked work', exact: true }) })
  await playbook.getByRole('button', { name: 'Pause playbook' }).click()
  await page.reload()
  await page.getByLabel('Review status').selectOption('all')
  await expect(blocker).toHaveCount(0)
  await page.getByRole('button', { name: 'Playbooks', exact: true }).click()
  await playbook.getByRole('button', { name: 'Resume playbook' }).click()
  await page.getByRole('button', { name: 'Decision inbox' }).click()
  await expect(blocker).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('cube-mobile.png'), fullPage: true })
  await blocker.getByRole('link', { name: 'Open record' }).click()
  await expect(page.getByRole('dialog').getByRole('textbox', { name: /Title/ })).toHaveValue('Cube blocker')
})

test('view-only members cannot review or see finance and Growth evidence', async ({ page }) => {
  await signInAndSeed(page)
  // Before the app loads: the running page can save its store again
  // (Cube's demo runtime does) and undo an edit made just before the reload.
  await page.addInitScript(() => {
    const saved = JSON.parse(localStorage.getItem('deskdev-store')!)
    const user = saved.state.users.find((item: { id: string }) => item.id === saved.state.currentUserId)
    user.role = 'member'
    user.permissions = { tasks: 'view', projects: 'edit' }
    localStorage.setItem('deskdev-store', JSON.stringify(saved))
  })
  await page.reload()
  await expect(page.getByRole('article', { name: 'Cube blocker' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Cube prospect' })).toHaveCount(0)
  await expect(page.getByRole('article', { name: 'Client portal redesign' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Acknowledge', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Snooze 24 hours' })).toHaveCount(0)
})

test('changed evidence reopens a review and corrupt history is not overwritten', async ({ page }) => {
  await signInAndSeed(page)
  const blocker = page.getByRole('article', { name: 'Cube blocker' })
  await blocker.getByRole('button', { name: 'Acknowledge', exact: true }).click()
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('deskdev-store')!)
    saved.state.tasks[0].notes = 'New approval needed'
    localStorage.setItem('deskdev-store', JSON.stringify(saved))
  })
  await page.reload()
  await expect(blocker).toBeVisible()
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((value) => value.startsWith('deskdev-cube:v1:'))!
    localStorage.setItem(key, '{broken')
  })
  await page.reload()
  // Next.js adds its own empty role=alert (the route announcer); find ours by its text.
  await expect(page.getByRole('alert').filter({ hasText: 'Personal review history could not be loaded' })).toBeVisible()
  await expect(blocker.getByRole('button', { name: 'Acknowledge', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => localStorage.getItem(Object.keys(localStorage).find((value) => value.startsWith('deskdev-cube:v1:'))!))).toBe('{broken')
})
