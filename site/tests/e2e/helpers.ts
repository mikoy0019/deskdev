import type { Page } from '@playwright/test'

/**
 * Resolves once React has taken over the element `selector` names.
 *
 * The server sends each page as HTML first and the browser makes it
 * interactive a moment later. A click that lands in between is handled by the
 * browser alone: a form submits the plain way, a button does nothing. A person
 * needs seconds to reach a control; a test needs milliseconds, so it waits for
 * the handlers to be there before it acts.
 */
export async function hydrated(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel)
    // React hangs its props on every element it owns, under a per-page key.
    return el !== null && Object.keys(el).some((key) => key.startsWith('__reactProps$'))
  }, selector)
}
