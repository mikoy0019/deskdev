'use client'

import { StrictMode, useEffect, type CSSProperties } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Toaster } from 'sonner'
import { BASE_PATH } from './lib/basePath'
import App from './App'
import { MotionProvider } from './components/motion/MotionProvider'
import { ThemeProvider, useTheme } from './theme/ThemeContext'
import { reportBoundaryErrors, watchWindowErrors } from './errorReporting'
import { initInstallPrompt } from './pwa/install'
import { registerServiceWorker } from './pwa/serviceWorker'
import { useIsPhone } from './pwa/useMediaQuery'

// Chrome fires beforeinstallprompt before this chunk has even loaded; adopt
// what the workspace layout's <head> script caught, ahead of the first render.
initInstallPrompt()

// Before the first render too: the boundary can catch an error in that render.
reportBoundaryErrors()

// Phones: top-centre, clear of the tab bar, the chat composer and the keyboard
// — where native banners appear — and below the status bar.
const PHONE_TOASTS = { top: 'calc(var(--safe-top, 0px) + 12px)', left: 12, right: 12 }

// Success / error keep a coloured mark (never colour alone: the glyph differs too).
const TOAST_ICONS = {
  success: <CheckCircleIcon size={16} weight="fill" className="text-emerald-600 dark:text-emerald-400" aria-hidden />,
  error: <WarningCircleIcon size={16} weight="fill" className="text-rose-600 dark:text-rose-400" aria-hidden />,
}

/** Toasts styled from the active theme — must live inside ThemeProvider. */
function ThemedToaster() {
  const { isDark } = useTheme()
  const isPhone = useIsPhone()
  return (
    <Toaster
      theme={isDark ? 'dark' : 'light'}
      position={isPhone ? 'top-center' : 'bottom-right'}
      // Sonner switches to mobileOffset under 600px; the phone layout starts at 640px.
      offset={isPhone ? PHONE_TOASTS : undefined}
      mobileOffset={PHONE_TOASTS}
      icons={TOAST_ICONS}
      style={
        {
          // DeskDev's surfaces, not Sonner's palette; the app font; the documented z rung.
          // Dark toasts sit a rung lighter (the hover surface) to lift off the page.
          '--normal-bg': isDark ? 'rgb(var(--ink-700))' : 'rgb(var(--ink-800))',
          '--normal-text': 'rgb(var(--ink-50))',
          '--normal-border': `rgb(var(${isDark ? '--ink-500' : '--ink-600'}))`,
          fontFamily: 'inherit',
          zIndex: 9999,
        } as CSSProperties
      }
      toastOptions={{ style: { fontSize: '14px' } }}
    />
  )
}

/**
 * DeskDev, mounted client-side only by app/workspace/[[...path]]/page.tsx (it
 * reads localStorage, window and the Supabase session from the first render).
 * Its screens keep their own react-router routes under /workspace.
 */
export default function Root() {
  // Production builds only — a no-op under next dev.
  useEffect(() => {
    registerServiceWorker()
  }, [])

  // Uncaught errors and unhandled rejections, for as long as the app is mounted.
  useEffect(() => watchWindowErrors(), [])

  return (
    <StrictMode>
      {/* LazyMotion (domMax) + MotionConfig reducedMotion="user" + input-modality tracking. */}
      <MotionProvider>
        <BrowserRouter basename={BASE_PATH}>
          <ThemeProvider>
            <App />
            <ThemedToaster />
          </ThemeProvider>
        </BrowserRouter>
      </MotionProvider>
    </StrictMode>
  )
}
