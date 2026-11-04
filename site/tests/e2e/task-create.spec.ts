import { test, expect } from '@playwright/test'

// The money path (e2e_video_proof §3.4). DeskDev Studio is a client-ops tool —
// the thing it exists to do is capture and track work. If quick-add is broken,
// the product is broken regardless of what else passes.
//
// Precondition discovered by running it: the quick-add submit is
// `disabled={!qaClient || !qaTitle.trim()}` — a task REQUIRES a client. The
// placeholder ("Enter to save") does not say so, which is logged as a UX
// finding in the report, but the required flow is title + client.

test('quick-add creates a task that persists across reload', async ({ page }) => {
  const title = `E2E smoke task ${Date.now()}`

  await page.goto('/workspace/tasks')
  await expect(page).not.toHaveURL(/\/login$/)

  const form = page.locator('form').filter({ has: page.getByPlaceholder(/Quick add a task/i) })
  await expect(form).toBeVisible({ timeout: 10_000 })

  await form.getByPlaceholder(/Quick add a task/i).fill(title)

  // First <select> in the quick-add form is the client picker. Index 0 is the
  // disabled "Select a client…" placeholder, so take the first real option.
  const clientSelect = form.locator('select').first()
  const options = await clientSelect.locator('option').all()
  expect(options.length, 'seed data must provide at least one client').toBeGreaterThan(1)
  await clientSelect.selectOption({ index: 1 })

  const addButton = form.getByRole('button', { name: /Add/i })
  await expect(addButton, 'submit enables once title + client are set').toBeEnabled()
  await addButton.click()

  // The new task must appear in the list.
  await expect(page.getByText(title, { exact: false }).first()).toBeVisible({ timeout: 10_000 })

  // And must survive a reload — this is what proves persistence actually wired
  // up, rather than the row only existing in React state.
  await page.reload()
  await expect(page.getByText(title, { exact: false }).first()).toBeVisible({ timeout: 15_000 })
})

// Regression for the rapid_ops fix of 2026-08-25. The submit button used to be
// `disabled={!qaClient || !qaTitle.trim()}`, which meant the form could never
// submit in those states — so submitQuickAdd never ran and its two toasts
// ("Give the task a title" / "Pick a client first") were unreachable dead code,
// and the placeholder's "Enter to save" promise was silently broken.
//
// This asserts the failure is now VOICED rather than silent.
test('quick-add explains itself instead of failing silently', async ({ page }) => {
  await page.goto('/workspace/tasks')
  await expect(page).not.toHaveURL(/\/login$/)

  const form = page.locator('form').filter({ has: page.getByPlaceholder(/Quick add a task/i) })
  await expect(form).toBeVisible({ timeout: 10_000 })

  // Title, but no client — previously a dead end with zero feedback.
  await form.getByPlaceholder(/Quick add a task/i).fill('Task with no client selected')
  await form.getByRole('button', { name: /Add/i }).click()

  await expect(page.getByText(/Pick a client first/i)).toBeVisible({ timeout: 10_000 })

  // And pressing Enter must behave the same, since the placeholder promises it.
  await page.reload()
  const form2 = page.locator('form').filter({ has: page.getByPlaceholder(/Quick add a task/i) })
  await form2.getByPlaceholder(/Quick add a task/i).fill('Enter-key path')
  await form2.getByPlaceholder(/Quick add a task/i).press('Enter')
  await expect(page.getByText(/Pick a client first/i)).toBeVisible({ timeout: 10_000 })
})
