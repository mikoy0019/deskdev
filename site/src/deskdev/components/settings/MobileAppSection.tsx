import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRightIcon, BellRingingIcon, CaretDownIcon, DeviceMobileIcon, DeviceTabletIcon,
  DownloadSimpleIcon, LaptopIcon,
} from '@phosphor-icons/react'
import { Panel } from './formKit'
import { detectPlatform, installMethod } from '../../pwa/platform'
import { useInstallPrompt } from '../../pwa/install'
import { useIsStandalone } from '../../pwa/useMediaQuery'
import { appUrl } from '../../pwa/paths'
import { browserName, deviceName, installGuide } from '../../pwa/installGuides'
import InstallSteps, { ChromeCallout, Emphasis, InstallLinkActions } from '../mobile/InstallSteps'
import QrCode from '../mobile/QrCode'

const TROUBLESHOOTING: { q: string; a: string }[] = [
  {
    q: 'There’s no Install option',
    a: 'iPhone and iPad install from the **Share** menu, never from an Install button. On Android, use Chrome. Inside another app’s browser (Instagram, Facebook, Gmail…), open the page in Safari or Chrome first.',
  },
  {
    q: 'The icon opens Safari instead of the app',
    a: '**Open as Web App** was off when it was added (iOS 26 and later). Remove the icon and add it again with the switch on.',
  },
  {
    q: 'I’m signed out in the app',
    a: 'On iPhone and iPad the app keeps its own storage, separate from Safari. Sign in once inside the app and it stays signed in.',
  },
  {
    q: 'Notifications don’t arrive',
    a: 'Turn them on inside the installed app (**Settings → Notifications**), then check that DeskDev is allowed in your phone’s notification settings and Focus modes.',
  },
  {
    q: 'The app looks out of date',
    a: 'DeskDev updates itself. If it still looks old, close it completely and open it again.',
  },
]

/**
 * Settings → Mobile app: whether this device runs the installed app, how to
 * install it here, and a QR code and link for putting it on a phone.
 */
export default function MobileAppSection({ onOpenNotifications }: { onOpenNotifications?: () => void }) {
  const standalone = useIsStandalone()
  const { canPrompt, installed, promptInstall } = useInstallPrompt()
  const [accepted, setAccepted] = useState(false)
  const platform = useMemo(() => detectPlatform(), [])
  const installUrl = useMemo(() => appUrl('/install'), [])
  const method = installMethod(platform, { standalone, canPrompt })
  const guide = installGuide(method, platform)
  // These guides lean on the install page's own controls (Open in Chrome, the
  // copy-link box, "this page shows you how"), so Settings points there instead.
  const viaInstallPage = method === 'in-app-browser' || method === 'unsupported'

  const DeviceIcon = platform.isIPad ? DeviceTabletIcon : platform.isMobile ? DeviceMobileIcon : LaptopIcon

  const install = () => {
    // No await before prompt(): it needs this click's user activation.
    void promptInstall().then((result) => setAccepted(result === 'accepted'))
  }

  let status: string
  if (standalone) status = 'You’re using the installed DeskDev app.'
  else if (installed) status = 'DeskDev is installed. Open it from your home screen, dock or app list.'
  else status = `DeskDev is open in ${browserName(platform)} on your ${deviceName(platform)}.`

  const isInstalled = standalone || installed

  return (
    <div className="space-y-5">
      <Panel
        title={
          <span className="flex flex-wrap items-center gap-2">
            This device
            <span className={isInstalled ? 'badge badge-success' : 'badge badge-neutral'}>
              {isInstalled ? 'Installed' : 'In the browser'}
            </span>
          </span>
        }
        icon={DeviceIcon}
        iconTone={isInstalled ? 'brand' : 'neutral'}
        description={status}
      >
        {!isInstalled && (
          <div className="border-t border-ink-600 pt-5">
            {accepted ? (
              <p className="text-sm text-ink-100" role="status">
                Installing. DeskDev will appear on your {platform.isMobile ? 'home screen' : 'computer'} in a few seconds.
              </p>
            ) : method === 'prompt' ? (
              <>
                <button type="button" className="btn-primary pointer-coarse:min-h-11" onClick={install}>
                  <DownloadSimpleIcon size={14} aria-hidden />
                  Install DeskDev
                </button>
                <p className="mt-2 text-xs text-ink-300">
                  {platform.isMobile
                    ? 'Adds DeskDev to your home screen. Free, no app store.'
                    : 'Gives DeskDev its own window and a place in your dock or taskbar.'}
                </p>
              </>
            ) : (
              <>
                {guide.recommendChrome && platform.os === 'android' && (
                  <ChromeCallout className="mb-5" installUrl={installUrl} />
                )}
                <h4 className="text-sm font-semibold text-ink-50">{guide.title}</h4>
                <p className="mt-1 max-w-[65ch] text-xs leading-relaxed text-ink-300">
                  <Emphasis text={guide.intro} />
                </p>
                {viaInstallPage ? (
                  <p className="mt-2 text-xs text-ink-300">The install page walks you through it step by step.</p>
                ) : (
                  <>
                    <InstallSteps className="mt-4" steps={guide.steps} compact />
                    {guide.note && (
                      <p className="mt-4 max-w-[65ch] text-xs leading-relaxed text-ink-300">
                        <Emphasis text={guide.note} />
                      </p>
                    )}
                  </>
                )}
                <Link
                  to="/install"
                  className="group/link mt-4 inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline pointer-coarse:min-h-11 dark:text-brand-400"
                >
                  {viaInstallPage ? 'Open the install page' : 'Full instructions for every device'}
                  <ArrowRightIcon size={14} aria-hidden className="transition-transform duration-150 ease-out [@media(hover:hover)_and_(pointer:fine)]:group-hover/link:translate-x-0.5" />
                </Link>
              </>
            )}
          </div>
        )}
      </Panel>

      <Panel
        title="Put DeskDev on your phone"
        description="Scan the code with your phone’s Camera app (not the Code Scanner), or send yourself the link. The page shows the right steps for that phone."
      >
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
          {/* Seated on a recessed plate, so the code reads as an object, not a sticker. */}
          <div className="shrink-0 rounded-xl border border-ink-600 bg-ink-900/50 p-2">
            <QrCode value={installUrl} size={148} className="rounded-lg" />
          </div>
          <div className="w-full min-w-0 flex-1">
            <InstallLinkActions url={installUrl} />
            <Link
              to="/install"
              className="group/link mt-3 inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline pointer-coarse:min-h-11 dark:text-brand-400"
            >
              Open the install page
              <ArrowRightIcon size={14} aria-hidden className="transition-transform duration-150 ease-out [@media(hover:hover)_and_(pointer:fine)]:group-hover/link:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </Panel>

      <Panel
        title="Notifications on your phone"
        icon={BellRingingIcon}
        description="Push notifications arrive through the installed app. Open DeskDev from your home screen, then turn them on in Settings → Notifications. iPhone and iPad need iOS 16.4 or later."
        bodyClassName="pb-5 pt-4 sm:pl-[4.75rem]"
      >
        {onOpenNotifications && (
          <button type="button" className="btn-secondary pointer-coarse:min-h-11" onClick={onOpenNotifications}>
            Notification settings
            <ArrowRightIcon size={14} aria-hidden />
          </button>
        )}
      </Panel>

      <Panel title="Troubleshooting" bodyClassName="pt-3">
        <div className="-mx-5 divide-y divide-ink-600 border-t border-ink-600">
          {TROUBLESHOOTING.map(({ q, a }) => (
            <details key={q} className="group">
              <summary className="pressable flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm font-medium text-ink-100 hover:bg-ink-700/30 hover:text-ink-50 [&::-webkit-details-marker]:hidden">
                {q}
                {/* The caret turns on the on-screen curve (morph, not an entrance). */}
                <CaretDownIcon
                  size={15}
                  className="shrink-0 text-ink-300 transition-transform duration-200 ease-in-out group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              {/* The answer arrives with a short fade-rise when opened (rare,
                  explanatory); closing is instant. */}
              <p className="max-w-[65ch] px-5 pb-4 text-xs leading-relaxed text-ink-200 group-open:animate-fade-rise">
                <Emphasis text={a} />
              </p>
            </details>
          ))}
        </div>
      </Panel>
    </div>
  )
}
