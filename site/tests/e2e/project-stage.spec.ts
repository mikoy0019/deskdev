import { test, expect, type Page } from '@playwright/test'

// Revision item 1 (2026-10-08): the project page carried a task-style Status
// row under the stage bar, and clicking Done there left projects "Onboarding"
// and "Done" at once. Now the stage bar is the one control: Done comes from
// "Development done" and only "Reopen development" takes it away.
//
// 'pr-portal' is the seed's "Client portal redesign", in development / In Progress.

const PROJECT = '/workspace/projects/pr-portal'

async function openProject(page: Page) {
  await page.goto(PROJECT)
  await expect(page).not.toHaveURL(/\/login$/)
  await expect(page.getByRole('region', { name: 'Project stage' })).toBeVisible({ timeout: 15_000 })
}

const details = (page: Page) => page.getByRole('complementary', { name: 'Project details' })

test('the project page has the stage bar and no task-style status picker', async ({ page }) => {
  await openProject(page)
  await expect(page.locator('#project-status-label')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Backlog', exact: true })).toHaveCount(0)
  // The work status still reads, in the details panel.
  await expect(details(page).getByText('Status', { exact: true })).toBeVisible()
  await expect(details(page).getByText('In Progress', { exact: true })).toBeVisible()
})

test('neither the list nor the edit form offers Done before launch', async ({ page }) => {
  await page.goto('/workspace/projects')
  const select = page.getByRole('combobox', { name: 'Status of Client portal redesign' })
  await expect(select).toBeVisible({ timeout: 15_000 })
  await expect(select.locator('option')).toHaveText(['Backlog', 'Planning', 'In Progress', 'Waiting'])

  await openProject(page)
  await page.getByRole('button', { name: 'Edit project' }).click()
  const dialog = page.getByRole('dialog')
  // By role: the label wraps the select, so its text also holds the options.
  const status = dialog.getByRole('combobox', { name: 'Status', exact: true })
  await expect(status).toBeVisible()
  await expect(status.locator('option')).toHaveText(['Backlog', 'Planning', 'In Progress', 'Waiting'])
})

test('launching sets Done, and reopening development takes it back', async ({ page }) => {
  await openProject(page)
  const stage = page.getByRole('region', { name: 'Project stage' })

  await stage.getByRole('button', { name: 'Development done' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Mark as launched' }).click()
  await expect(stage.locator('[aria-current="step"]')).toContainText('Launched')
  await expect(details(page).getByText('Done', { exact: true })).toBeVisible()

  await stage.getByRole('button', { name: 'Reopen development' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Reopen' }).click()
  await expect(stage.locator('[aria-current="step"]')).toContainText('Development')
  await expect(details(page).getByText('In Progress', { exact: true })).toBeVisible()
})
