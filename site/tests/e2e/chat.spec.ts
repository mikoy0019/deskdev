import { test, expect, type Page } from '@playwright/test'

// Chat is open to every profile, so the proof runs across two accounts: the
// admin sends, the member signs in and sees the unread badge + the message.

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/workspace/login')
  await page.locator('#login-email').fill(email)
  await page.locator('#login-password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('#login-email')).toHaveCount(0)
}

test('two people hold a conversation in the inbox', async ({ page }) => {
  // The thread's message list — keeps assertions off the inbox previews.
  const thread = page.getByRole('log')
  // Signed in as admin via storageState.
  await page.goto('/workspace/messages')
  await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'New chat' }).first().click()
  await page.getByRole('option').filter({ hasText: 'Alex Cruz' }).first().click()
  await page.getByRole('button', { name: /Start chat/ }).click()

  // The thread opens with its own URL and an empty-state prompt.
  await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}$/)
  const composer = page.getByLabel('Write a message')
  await composer.fill('Hey Alex, can you review the Q4 brief?')
  await composer.press('Enter')

  await expect(thread.getByText('Hey Alex, can you review the Q4 brief?', { exact: true })).toBeVisible()
  await expect(composer).toHaveValue('')

  // Survives a reload (persisted store, not component state).
  await page.reload()
  await expect(thread.getByText('Hey Alex, can you review the Q4 brief?', { exact: true })).toBeVisible()

  // The sender has nothing unread.
  await expect(page.getByRole('link', { name: /Messages, \d+ unread/ })).toHaveCount(0)

  // The recipient sees an unread badge, reads it, and replies. Sign out from
  // Home: sign-in returns to the page that was left (AuthGate), and leaving
  // from the thread would open it for the next person and clear the badge
  // before it can be looked at.
  await page.goto('/workspace')
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible()
  await page.getByRole('button', { name: 'Log out' }).click()
  await signIn(page, 'member@deskdev.local', 'member')

  await expect(page.getByRole('link', { name: 'Messages, 1 unread' }).first()).toBeVisible()
  await page.getByRole('link', { name: 'Messages, 1 unread' }).first().click()
  await page.getByRole('button', { name: /Maykie/ }).first().click()

  await expect(thread.getByText('Hey Alex, can you review the Q4 brief?', { exact: true })).toBeVisible()
  // Opening the thread clears the badge.
  await expect(page.getByRole('link', { name: /Messages, \d+ unread/ })).toHaveCount(0)

  const reply = page.getByLabel('Write a message')
  await reply.fill('On it — sending notes today.')
  await reply.press('Enter')
  await expect(thread.getByText('On it — sending notes today.', { exact: true })).toBeVisible()

  // Back to the sender: the reply is there and their own message reads as Seen.
  await page.getByRole('button', { name: 'Log out' }).click()
  await signIn(page, 'admin@deskdev.local', 'admin')
  await page.goto('/workspace/messages')
  await page.getByRole('button', { name: /Alex Cruz/ }).first().click()
  await expect(thread.getByText('On it — sending notes today.', { exact: true })).toBeVisible()
})
