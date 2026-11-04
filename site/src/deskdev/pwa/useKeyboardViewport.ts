// Web-only (not mirrored to mobile). Keeps the shell above the on-screen
// keyboard. iOS (Safari 26/27 has no interactive-widget, VirtualKeyboard API or
// keyboard env() values) only shrinks the *visual* viewport when the keyboard
// opens: 100dvh, the layout viewport and our h-(--app-h) shell keep their
// height, the keyboard covers the chat composer and iOS pans the page to
// compensate. Android Chrome's default (resizes-visual) behaves the same way.
// While the keyboard is up we size the shell to the visual viewport and pin
// the page to the top; when it closes we hand back to 100dvh.
// It also marks <html data-keyboard="open"> (the tab bar hides itself, as in
// native apps) and zeroes --safe-bottom: the home-indicator inset sits behind
// the keyboard, so keeping it would leave a dead strip under the composer.
import { useEffect } from 'react'

/** Smaller than any phone keyboard, larger than Safari's toolbar collapsing. */
export const KEYBOARD_MIN_PX = 150

/**
 * The shell height (px) to use while the on-screen keyboard is open, or null
 * when it is closed. `layoutHeight` is the layout viewport (html clientHeight),
 * which the keyboard doesn't change; `viewportHeight`/`scale` come from
 * window.visualViewport. Pinch-zoom shrinks the visual viewport too, so
 * the height is compared at scale 1, and a zoomed page is left alone.
 */
export function keyboardShellHeight(layoutHeight: number, viewportHeight: number, scale = 1): number | null {
  if (!(layoutHeight > 0) || !(viewportHeight > 0)) return null
  if (scale > 1.01) return null
  if (layoutHeight - viewportHeight * scale < KEYBOARD_MIN_PX) return null
  return Math.round(viewportHeight)
}

/** Mounted once by Layout. Touch devices with visualViewport only; a no-op elsewhere. */
export function useKeyboardViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv || typeof window.matchMedia !== 'function') return
    if (!window.matchMedia('(pointer: coarse)').matches) return

    const root = document.documentElement
    let open = false
    let frame = 0

    const close = () => {
      root.style.removeProperty('--app-h')
      root.style.removeProperty('--safe-bottom')
      delete root.dataset.keyboard
      open = false
    }

    const update = () => {
      frame = 0
      const height = keyboardShellHeight(root.clientHeight, vv.height, vv.scale)
      if (height !== null) {
        root.style.setProperty('--app-h', `${height}px`)
        if (!open) {
          root.style.setProperty('--safe-bottom', '0px')
          root.dataset.keyboard = 'open'
        }
        open = true
        // iOS scrolls the layout viewport to bring the field into view; the
        // shell now fits the visible area, so undo that pan.
        if (window.scrollY !== 0) window.scrollTo(0, 0)
      } else if (open) {
        close()
        // iOS can leave the page shifted after the keyboard closes.
        window.scrollTo(0, 0)
      }
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }

    update()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    return () => {
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      if (frame) window.cancelAnimationFrame(frame)
      if (open) close()
    }
  }, [])
}
