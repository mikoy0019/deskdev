import { test, expect } from '@playwright/test'

// The 2026-10-07 revision list (items 2–10), walked through in the browser on
// the local-mode seed. Item 6 (a vault account per admin) needs the backend's
// MFA and RLS, so its proof is supabase/tests/revisions.test.mjs.

test('2: a task card names its project, and a task takes collaborators', async ({ page }) => {
  await page.goto('/workspace/tasks')
  const dash = page.locator('[data-card-id="t-dash"]')
  await expect(dash).toContainText('Client portal redesign', { timeout: 15_000 })
  await expect(dash.getByText('People: Alex Cruz, Maykie')).toBeAttached()

  // The card opens on a click; its "Open task" button is the keyboard route.
  await page.locator('[data-card-id="t-auth"]').getByText('Wire up auth flow').click()
  const dialog = page.getByRole('dialog', { name: 'Edit task' })
  await dialog.getByRole('button', { name: 'Add collaborators' }).click()
  const picker = page.getByRole('dialog', { name: 'Collaborators' })
  await picker.getByRole('option', { name: /Maykie/ }).click()
  await expect(picker.getByRole('option', { name: /Maykie/ })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await expect(dialog.getByRole('list', { name: 'Collaborators' })).toContainText('Maykie')
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.locator('[data-card-id="t-auth"]').getByText('People: Alex Cruz, Maykie')).toBeAttached()
})

test('3: "Move to" is a themed menu that moves the card', async ({ page }) => {
  await page.goto('/workspace/tasks')
  const card = page.locator('[data-card-id="t-copy"]')
  await expect(card).toBeVisible({ timeout: 15_000 })
  await card.hover()
  await card.getByRole('button', { name: 'Move to column' }).click()
  const menu = page.getByRole('menu', { name: 'Move to' })
  await expect(menu.getByRole('menuitem')).toHaveCount(3)
  await menu.getByRole('menuitem', { name: 'In Progress' }).click()
  await expect(menu).toBeHidden()
  const inProgress = page.locator('[data-kanban] section').filter({ has: page.locator('.section-title', { hasText: /^In Progress$/i }) })
  await expect(inProgress.locator('[data-card-id="t-copy"]')).toBeVisible()
})

test('4: CRM columns resize, insert beside each other, and hold people and formulas', async ({ page }) => {
  await page.goto('/workspace/crm/crm-leads')
  const edge = page.getByRole('separator', { name: 'Resize column Deal Value' })
  await expect(edge).toHaveAttribute('aria-valuenow', '180', { timeout: 15_000 })
  await edge.focus()
  await page.keyboard.press('ArrowRight')
  await expect(edge).toHaveAttribute('aria-valuenow', '196')

  // A person column, inserted right of Deal Value from the column menu.
  await page.getByRole('button', { name: 'Column menu: Deal Value' }).click()
  await page.getByRole('menuitem', { name: 'Insert column right' }).click()
  const form = page.getByRole('dialog', { name: 'New column' })
  await form.getByPlaceholder('Column name').fill('Owner')
  await form.getByLabel('Type').selectOption('person')
  await form.getByRole('button', { name: 'Add column' }).click()
  await expect(page.getByRole('columnheader').nth(4)).toContainText('Owner')
  await page.getByRole('button', { name: 'Owner: empty' }).first().click()
  await page.getByRole('menuitemradio', { name: 'Alex Cruz' }).click()
  await expect(page.getByRole('button', { name: 'Owner: Alex Cruz' })).toBeVisible()

  // A formula column that fills itself in from Deal Value.
  await page.getByRole('button', { name: 'Column menu: Source' }).click()
  await page.getByRole('menuitem', { name: 'Insert column right' }).click()
  await form.getByPlaceholder('Column name').fill('Fee')
  await form.getByLabel('Type').selectOption('formula')
  await form.getByRole('button', { name: 'Next' }).click()
  const editor = page.getByRole('dialog', { name: 'New formula column' })
  await editor.getByLabel('Formula').fill('{Deal Value} * 0.1')
  await expect(editor.getByText(/First 3 rows: 450 · 280 · 720/)).toBeVisible()
  await editor.getByRole('button', { name: 'Add column' }).click()
  await expect(page.getByLabel('Fee: 450')).toBeVisible()
})

test('5: a course topic can be a written note', async ({ page }) => {
  const course = `E2E notes ${Date.now()}`
  await page.goto('/workspace/courses')
  await page.getByRole('button', { name: 'New course' }).first().click()
  await page.getByRole('dialog', { name: 'New course' }).getByLabel('Title').fill(course)
  await page.getByRole('dialog', { name: 'New course' }).getByRole('button', { name: 'Create' }).click()
  await page.getByRole('link', { name: new RegExp(course) }).first().click()
  await page.getByRole('button', { name: 'New module' }).first().click()
  await page.getByRole('dialog', { name: 'New module' }).getByLabel('Title').fill('Handover')
  await page.getByRole('dialog', { name: 'New module' }).getByRole('button', { name: 'Add module' }).click()

  await page.getByRole('button', { name: 'Add a note to Handover' }).click()
  const note = page.getByRole('dialog', { name: 'Add a note' })
  await note.getByLabel('Title').fill('Launch checklist')
  await note.getByLabel('Note').fill('1. Point the domain\n2. Turn on backups')
  await note.getByRole('button', { name: 'Add', exact: true }).click()

  await page.getByRole('button', { name: 'Read note: Launch checklist' }).click()
  await expect(page.getByRole('dialog', { name: 'Launch checklist' }).getByRole('region', { name: 'Note' })).toContainText('Turn on backups')
})

test('7: the right rail counts who is active and lists everyone', async ({ page }) => {
  await page.goto('/workspace/tasks')
  await page.getByRole('button', { name: 'People: 1 active now' }).click()
  const panel = page.getByRole('dialog', { name: 'People' })
  await expect(panel.getByRole('region', { name: 'Active now' })).toContainText('Maykie (you)')
  await expect(panel.getByRole('region', { name: 'Offline' })).toContainText('Alex Cruz')
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
})

test('8: meeting recordings are filed by client and project, and play', async ({ page }) => {
  await page.goto('/workspace/recordings')
  const list = page.getByRole('list', { name: 'Recordings' })
  await expect(list.getByRole('listitem')).toHaveCount(2, { timeout: 15_000 })
  await page.getByRole('button', { name: 'Expand Northwind Digital' }).click()
  await page.getByRole('button', { name: /^Client portal redesign/ }).click()
  await expect(list.getByRole('listitem')).toHaveCount(1)

  await page.getByRole('button', { name: 'Add recording' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add a recording' })
  await dialog.getByLabel('Recording link').fill('https://www.loom.com/share/0123456789abcdef0123456789abcdef')
  await dialog.getByLabel('Title').fill('Sprint review')
  await dialog.getByRole('button', { name: 'Add recording' }).click()
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await page.getByRole('button', { name: 'Play Sprint review' }).click()
  await expect(page.getByRole('dialog', { name: 'Sprint review' }).locator('iframe')).toHaveAttribute('src', /loom\.com\/embed\//)
})

test('9: a whiteboard opens in Excalidraw and saves what is drawn', async ({ page }) => {
  await page.goto('/workspace/whiteboard')
  await page.getByRole('button', { name: 'New whiteboard' }).first().click()
  await page.getByLabel('Board title').fill('Site map')
  await page.getByRole('button', { name: 'Create and open' }).click()
  await expect(page).toHaveURL(/\/workspace\/whiteboard\/[^/]+$/)
  const canvas = page.locator('.excalidraw canvas.interactive')
  await expect(canvas).toBeVisible({ timeout: 45_000 })

  const box = (await canvas.boundingBox())!
  await page.getByTitle(/^Rectangle/).first().click()
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2 - 60)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 60, { steps: 10 })
  await page.mouse.up()

  const boardId = page.url().split('/').pop()!
  await expect.poll(
    () => page.evaluate((id) => JSON.parse(localStorage.getItem('deskdev-whiteboards:v1') ?? '{}').scenes?.[id]?.elements?.length ?? 0, boardId),
    { timeout: 20_000 },
  ).toBeGreaterThan(0)
  await expect(page.getByText(/^Saved/)).toBeVisible()

  await page.getByRole('link', { name: 'All whiteboards' }).click()
  await expect(page.getByRole('list', { name: 'Whiteboards' })).toContainText('Site map')
})

test('10: the assistant answers from the data and asks before changing anything', async ({ page }) => {
  await page.goto('/workspace/assistant')
  const input = page.getByLabel('Ask the Assistant')
  const log = page.getByRole('log', { name: 'Conversation' })
  await input.fill('projects due this week')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(log).toContainText(/Projects due this week or earlier|No projects due this week/)

  await input.fill('create a task Call the printer for Casa Palma due Friday')
  await input.press('Enter')
  await expect(log.getByText('Create a task', { exact: true })).toBeVisible()
  await expect(log).toContainText('Casa Palma')
  await log.getByRole('button', { name: 'Confirm' }).click()
  await expect(log).toContainText('Created “Call the printer”.')

  await page.goto('/workspace/tasks')
  await expect(page.getByText('Call the printer').first()).toBeVisible({ timeout: 15_000 })
})
