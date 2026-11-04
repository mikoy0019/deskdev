import { useEffect, useMemo, useState } from 'react'
import { ArrowsClockwiseIcon, DownloadSimpleIcon, ShieldWarningIcon, WindowsLogoIcon } from '@phosphor-icons/react'
import { Panel } from './formKit'
import {
  compareVersions, desktopAppVersion, fetchDesktopRelease, formatSize, isWindows, type DesktopRelease,
} from '../../lib/desktopApp'
import { fmtDate } from '../../lib/format'

const STEPS: { title: string; body: string }[] = [
  { title: 'Download', body: 'Get DeskDev-Setup.exe with the button above.' },
  {
    title: 'Open it',
    body: 'If Windows says “Windows protected your PC”, choose More info, then Run anyway. The installer isn’t code-signed yet, so Windows doesn’t recognise it.',
  },
  { title: 'Install', body: 'Pick whether you want a desktop icon and press Install. No administrator rights needed.' },
  { title: 'Sign in', body: 'DeskDev opens in its own window. Sign in once; it stays signed in.' },
]

/**
 * Settings → Desktop app: the Windows installer (desktop/ in the repo,
 * published to /downloads by desktop/build.mjs), and, inside the app, which
 * version this is and whether a newer one is out.
 */
export default function DesktopAppSection() {
  const [release, setRelease] = useState<DesktopRelease | null | undefined>(undefined)
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const running = useMemo(() => desktopAppVersion(userAgent), [userAgent])
  const onWindows = useMemo(() => isWindows(userAgent), [userAgent])

  useEffect(() => {
    const ctrl = new AbortController()
    void fetchDesktopRelease(ctrl.signal).then((r) => {
      if (!ctrl.signal.aborted) setRelease(r)
    })
    return () => ctrl.abort()
  }, [])

  const updateAvailable = Boolean(running && release && compareVersions(release.version, running) > 0)

  const meta = release
    ? [`Version ${release.version}`, formatSize(release.size), release.released ? `published ${fmtDate(release.released)}` : null]
        .filter(Boolean)
        .join(' · ')
    : null

  const download = (label: string) =>
    release && (
      <a href={release.url} download className="btn-primary pointer-coarse:min-h-11">
        <DownloadSimpleIcon size={14} aria-hidden />
        {label}
      </a>
    )

  let status: string
  if (running) {
    status = updateAvailable
      ? `You’re using DeskDev for Windows ${running}. Version ${release!.version} is out — download it and run the installer to update; you stay signed in.`
      : `You’re using DeskDev for Windows ${running}, the latest version.`
  } else {
    status = 'DeskDev in its own window, with a taskbar icon and a Start menu entry. It stays signed in and tells you when a new version is out.'
  }

  return (
    <div className="space-y-5">
      <Panel
        title={
          <span className="flex flex-wrap items-center gap-2">
            DeskDev for Windows
            {running && (
              <span className={updateAvailable ? 'badge badge-warn' : 'badge badge-success'}>
                {updateAvailable ? 'Update available' : 'Installed'}
              </span>
            )}
          </span>
        }
        icon={WindowsLogoIcon}
        iconTone={running ? 'brand' : 'neutral'}
        description={status}
      >
        {(!running || updateAvailable) && (
          <div className="border-t border-ink-600 pt-5">
            {release === undefined ? (
              <p className="text-sm text-ink-300" role="status">Checking for the installer…</p>
            ) : release === null ? (
              <p className="max-w-[65ch] text-sm text-ink-200">
                The Windows installer isn’t published on this server yet. An admin builds it with{' '}
                <code className="font-mono text-xs">npm run build</code> in <code className="font-mono text-xs">desktop/</code> and deploys the site.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {download(updateAvailable ? `Download ${release.version}` : 'Download for Windows')}
                  <span className="font-mono text-xs text-ink-300">{meta}</span>
                </div>
                <p className="mt-2 text-xs text-ink-300">
                  {onWindows
                    ? 'Windows 10 (version 1809 or later) or Windows 11, 64-bit.'
                    : 'For Windows 10 and 11. On a Mac, install DeskDev from your browser instead (Settings → Mobile app shows how).'}
                </p>
              </>
            )}
          </div>
        )}
      </Panel>

      {!running && (
        <Panel title="Installing" icon={ShieldWarningIcon} description="Takes under a minute.">
          <ol className="space-y-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span
                  aria-hidden
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink-700 font-mono text-xs font-semibold text-ink-100"
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-50">{step.title}</p>
                  <p className="mt-0.5 max-w-[65ch] text-xs leading-relaxed text-ink-300">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <Panel
        title="Updating and removing"
        icon={ArrowsClockwiseIcon}
        description="When a new version is published, DeskDev shows a banner at the top of its window. Download it and run the installer; it updates in place and keeps you signed in. To remove DeskDev, open Windows Settings → Apps → Installed apps → DeskDev → Uninstall."
      >
        {release?.sha256 && (
          <p className="break-all font-mono text-[11px] leading-relaxed text-ink-400">
            SHA-256 of DeskDev-Setup.exe {release.version}: {release.sha256}
          </p>
        )}
      </Panel>
    </div>
  )
}
