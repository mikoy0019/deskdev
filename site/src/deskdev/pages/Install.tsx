// /install — public on purpose: the link is shared (and scanned) before anyone
// signs in, so it renders its own minimal chrome instead of the app Layout.
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeftIcon, ArrowRightIcon, ArrowsClockwiseIcon, CircleNotchIcon,
  DeviceMobileIcon, DownloadSimpleIcon, type Icon, InfoIcon, LaptopIcon, SealCheckIcon,
  StorefrontIcon,
} from '@phosphor-icons/react'
import { useStore } from '../store/useStore'
import { assetUrl } from '../lib/basePath'
import { classNames } from '../lib/format'
import { detectPlatform, installMethod, type PlatformInfo } from '../pwa/platform'
import { useInstallPrompt } from '../pwa/install'
import { useIsStandalone } from '../pwa/useMediaQuery'
import { appUrl } from '../pwa/paths'
import {
  browserName,
  chromeIntentUrl,
  deviceGuide,
  deviceKind,
  deviceName,
  installGuide,
  lineExternalUrl,
  type DeviceKind,
  type InstallGuide,
} from '../pwa/installGuides'
import InstallSteps, { ChromeCallout, ChromeGlyph, Emphasis, InstallLinkActions } from '../components/mobile/InstallSteps'
import QrCode from '../components/mobile/QrCode'
import { IndicatorGroup, LayoutIndicator, Magnetic, Stagger } from '../components/motion'
import BrandMark from '../components/ui/BrandMark'

type Outcome = 'idle' | 'accepted' | 'dismissed'

const DEVICE_TABS: { id: DeviceKind; label: string; icon: Icon }[] = [
  { id: 'ios', label: 'iPhone & iPad', icon: DeviceMobileIcon },
  { id: 'android', label: 'Android', icon: DeviceMobileIcon },
  { id: 'desktop', label: 'Computer', icon: LaptopIcon },
]

export default function Install() {
  const signedIn = useStore((s) => s.currentUserId !== null)
  const standalone = useIsStandalone()
  const { canPrompt, installed, promptInstall } = useInstallPrompt()
  const [outcome, setOutcome] = useState<Outcome>('idle')

  // The UA doesn't change while the page is open.
  const platform = useMemo(() => detectPlatform(), [])
  const installUrl = useMemo(() => appUrl('/install'), [])
  const method = installMethod(platform, { standalone, canPrompt })
  const guide = installGuide(method, platform)
  const isDesktop = platform.os === 'desktop' || platform.os === 'other'

  const install = () => {
    // promptInstall() calls prompt() before anything is awaited, so the click's
    // user activation still counts.
    void promptInstall().then((result) => {
      if (result === 'accepted') setOutcome('accepted')
      else if (result === 'dismissed') setOutcome('dismissed')
    })
  }

  let primary: ReactNode
  if (method === 'installed') primary = <InstalledCard signedIn={signedIn} />
  else if (outcome === 'accepted' || installed) primary = <InstallingCard platform={platform} done={installed} />
  else if (method === 'prompt') primary = <PromptCard platform={platform} guide={guide} onInstall={install} retry={outcome === 'dismissed'} />
  else if (method === 'in-app-browser') primary = <InAppCard platform={platform} guide={guide} installUrl={installUrl} />
  else
    primary = (
      <GuideCard platform={platform} guide={guide} installUrl={installUrl} dismissed={outcome === 'dismissed'} />
    )

  return (
    <div className="min-h-dvh flex flex-col bg-ink-900 text-ink-100">
      <header
        className="border-b border-ink-600 bg-ink-850"
        style={{
          paddingTop: 'var(--safe-top, env(safe-area-inset-top, 0px))',
          paddingLeft: 'var(--safe-left, env(safe-area-inset-left, 0px))',
          paddingRight: 'var(--safe-right, env(safe-area-inset-right, 0px))',
        }}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Link
            to={signedIn ? '/' : '/install'}
            className="-mx-1 flex min-h-11 items-center gap-2.5 rounded-lg px-1 focus-visible:outline-2 focus-visible:outline-brand-500"
            aria-label="DeskDev"
          >
            <BrandMark size={32} />
            <span className="text-display text-lg font-semibold text-ink-50">DeskDev</span>
          </Link>
          {signedIn ? (
            <Link to="/" className="btn-ghost -mr-2 pointer-coarse:min-h-11">
              <ArrowLeftIcon size={15} aria-hidden />
              Back to DeskDev
            </Link>
          ) : (
            <Link to="/login" className="btn-secondary pointer-coarse:min-h-11">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main
        className="flex-1"
        style={{
          paddingLeft: 'var(--safe-left, env(safe-area-inset-left, 0px))',
          paddingRight: 'var(--safe-right, env(safe-area-inset-right, 0px))',
          paddingBottom: 'var(--safe-bottom, env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* Editorial split from lg: the case for the app on the left (it stays
            in view while the steps scroll), what to do on the right. Phones
            stack it, left-aligned. */}
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
          {/* grid-cols-1, not the implicit auto track: the link box's nowrap
              text counts at full width in an auto track and pushed the cards
              45px past a 320px screen. */}
          <section className="grid grid-cols-1 gap-10 pt-10 pb-14 sm:pt-14 lg:pb-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16 lg:pt-20">
            {/* A rare, first-visit page: the hero's parts arrive in sequence once. */}
            <Stagger viewKey="install-hero" className="min-w-0 lg:sticky lg:top-12 lg:self-start">
              {/* eslint-disable-next-line @next/next/no-img-element -- client-only SPA; a fixed 192px PNG from public/, nothing to optimise */}
              <img
                src={assetUrl('/icons/icon-192.png')}
                alt=""
                width={64}
                height={64}
                className="h-16 w-16 rounded-[22%]"
                style={{ boxShadow: 'var(--shadow-3)' }}
              />
              <h1 className="mt-7 text-display text-[2rem] leading-[1.05] font-semibold tracking-[-0.035em] text-ink-50 text-balance sm:text-[2.75rem]">
                {method === 'installed' ? 'DeskDev is installed' : 'Get DeskDev on your phone'}
              </h1>
              <p className="mt-4 max-w-md text-base leading-relaxed text-ink-200 text-pretty">
                Install it straight from your browser. It opens full-screen like any app, stays signed in and can send
                you notifications.
              </p>
              <ul className="mt-7 max-w-md divide-y divide-ink-600 border-y border-ink-600">
                <Perk icon={StorefrontIcon}>No app store</Perk>
                <Perk icon={ArrowsClockwiseIcon}>Updates itself</Perk>
                <Perk icon={DeviceMobileIcon}>iPhone, Android, computer</Perk>
              </ul>
            </Stagger>

            <div className="grid min-w-0 grid-cols-1 items-start gap-4">
              {primary}
              {isDesktop && <PhoneQrCard installUrl={installUrl} />}
            </div>
          </section>

          <OtherDevices platform={platform} installUrl={installUrl} />
          <Faq />

          <footer className="border-t border-ink-600 py-10 text-xs text-ink-300">
            {signedIn ? (
              <Link to="/" className="inline-flex items-center font-medium text-brand-600 hover:underline pointer-coarse:min-h-11 dark:text-brand-400">
                Back to DeskDev
              </Link>
            ) : (
              <>
                Already have an account?{' '}
                <Link to="/login" className="inline-flex items-center font-medium text-brand-600 hover:underline pointer-coarse:min-h-11 dark:text-brand-400">
                  Sign in
                </Link>
              </>
            )}
          </footer>
        </div>
      </main>
    </div>
  )
}

function Perk({ icon: Icon, children }: { icon: Icon; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-3 text-sm font-medium text-ink-100">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-ink-600 bg-ink-800 text-ink-300 shadow-(--shadow-1)">
        <Icon size={16} aria-hidden />
      </span>
      {children}
    </li>
  )
}

/** 'Safari · iPhone' — so people can tell at a glance the steps are for them. */
function forLabel(p: PlatformInfo): string {
  return `${browserName(p)} · ${deviceName(p)}`
}

function CardHead({ label, guide }: { label: string; guide: InstallGuide }) {
  return (
    <>
      <p className="section-title">{label}</p>
      <h2 className="mt-1.5 text-display text-xl font-semibold text-ink-50">{guide.title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-200">
        <Emphasis text={guide.intro} />
      </p>
    </>
  )
}

function Note({ text }: { text: string }) {
  return (
    <p className="mt-5 flex gap-2.5 rounded-lg border border-ink-600 bg-ink-700/60 p-3 text-sm leading-relaxed text-ink-200">
      <InfoIcon size={15} className="mt-0.5 shrink-0 text-ink-300" aria-hidden />
      <span>
        <Emphasis text={text} />
      </span>
    </p>
  )
}

function InstalledCard({ signedIn }: { signedIn: boolean }) {
  const navigate = useNavigate()
  return (
    <section className="card p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/15 text-brand-600 dark:text-brand-400">
          <SealCheckIcon size={22} aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-display text-xl font-semibold text-ink-50">You’re using the app</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-200">
            DeskDev is installed on this device. Open it from your home screen any time.
          </p>
        </div>
      </div>
      <button
        type="button"
        className="btn-primary mt-5 h-12 w-full text-base"
        onClick={() => navigate(signedIn ? '/' : '/login')}
      >
        {signedIn ? 'Continue to DeskDev' : 'Sign in'}
        <ArrowRightIcon size={16} aria-hidden />
      </button>
    </section>
  )
}

function InstallingCard({ platform, done }: { platform: PlatformInfo; done: boolean }) {
  const mobile = platform.isMobile
  return (
    <section className="card p-5 sm:p-6" role="status">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/15 text-brand-600 dark:text-brand-400">
          {done ? <SealCheckIcon size={22} aria-hidden /> : <CircleNotchIcon size={22} className="animate-spin" aria-hidden />}
        </span>
        <div className="min-w-0">
          <h2 className="text-display text-xl font-semibold text-ink-50">{done ? 'DeskDev is installed' : 'Installing…'}</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-200">
            {mobile
              ? done
                ? 'Open DeskDev from your home screen. You can close this tab.'
                : 'DeskDev will appear on your home screen in a few seconds.'
              : done
                ? 'DeskDev opens in its own window and lives in your dock, taskbar or app list.'
                : 'DeskDev will open in its own window in a moment.'}
          </p>
        </div>
      </div>
      {mobile && (
        <p className="mt-4 text-sm leading-relaxed text-ink-300">
          Then turn on notifications inside the app: <strong className="font-semibold text-ink-100">Settings → Notifications</strong>.
        </p>
      )}
    </section>
  )
}

function PromptCard({
  platform,
  guide,
  onInstall,
  retry,
}: {
  platform: PlatformInfo
  guide: InstallGuide
  onInstall: () => void
  retry: boolean
}) {
  return (
    <section className="card p-5 sm:p-6">
      <CardHead label={forLabel(platform)} guide={guide} />
      {/* The page's one CTA, on a rare surface: it leans toward a mouse. */}
      <Magnetic className="mt-5 w-full">
        <button type="button" className="btn-primary h-12 w-full text-base" onClick={onInstall}>
          <DownloadSimpleIcon size={18} aria-hidden />
          Install DeskDev
        </button>
      </Magnetic>
      <p className="mt-3 text-center text-xs text-ink-300">
        {retry
          ? 'Changed your mind? The install dialog can be opened again any time.'
          : platform.isMobile
            ? 'Free. Takes a few seconds and adds DeskDev to your home screen.'
            : 'Free. DeskDev gets its own window and a place in your dock or taskbar.'}
      </p>
    </section>
  )
}

function GuideCard({
  platform,
  guide,
  installUrl,
  dismissed,
}: {
  platform: PlatformInfo
  guide: InstallGuide
  installUrl: string
  dismissed: boolean
}) {
  const showLink = guide.steps.some((s) => s.glyph === 'copy')
  return (
    <section className="card p-5 sm:p-6">
      {dismissed && (
        <p className="mb-5 rounded-lg border border-ink-600 bg-ink-700/60 p-3 text-sm text-ink-200" role="status">
          No problem. You can still install DeskDev from the browser menu whenever you like.
        </p>
      )}
      {guide.recommendChrome && platform.os === 'android' && <ChromeCallout className="mb-6" installUrl={installUrl} />}
      <CardHead label={forLabel(platform)} guide={guide} />
      <InstallSteps className="mt-5" steps={guide.steps} />
      {showLink && <InstallLinkActions className="mt-5" url={installUrl} />}
      {guide.note && <Note text={guide.note} />}
    </section>
  )
}

function InAppCard({ platform, guide, installUrl }: { platform: PlatformInfo; guide: InstallGuide; installUrl: string }) {
  // LINE honors ?openExternalBrowser=1 — the one documented way out of an
  // in-app browser. The page's own URL keeps any query it came with.
  const lineUrl = useMemo(
    () => (platform.inApp === 'line' ? lineExternalUrl(window.location.href) : null),
    [platform.inApp],
  )
  return (
    <section className="card p-5 sm:p-6">
      <CardHead label={`${browserName(platform)} · ${deviceName(platform)}`} guide={guide} />
      {(platform.os === 'android' || lineUrl) && (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          {platform.os === 'android' && (
            <a href={chromeIntentUrl(installUrl)} className="btn-primary h-12 flex-1 text-base">
              <ChromeGlyph size={18} />
              Open in Chrome
            </a>
          )}
          {lineUrl && (
            <a href={lineUrl} className={classNames(platform.os === 'android' ? 'btn-secondary' : 'btn-primary', 'h-12 flex-1 text-base')}>
              Open in your browser
            </a>
          )}
        </div>
      )}
      <InstallSteps className="mt-5" steps={guide.steps} />
      <div className="mt-5 border-t border-ink-600 pt-5">
        <p className="mb-2 text-sm font-medium text-ink-100">Or copy the link and paste it into your browser:</p>
        <InstallLinkActions url={installUrl} />
      </div>
      {guide.note && <Note text={guide.note} />}
    </section>
  )
}

function PhoneQrCard({ installUrl }: { installUrl: string }) {
  return (
    <section aria-label="Scan to install" className="card p-5 sm:p-6 sm:flex sm:items-center sm:gap-6">
      <QrCode value={installUrl} size={168} className="shrink-0 rounded-lg border border-ink-600 max-sm:mx-auto max-sm:mb-5" />
      <div className="min-w-0">
        <p className="section-title">On your phone</p>
        <h2 className="mt-1.5 text-display text-lg font-semibold text-ink-50">Scan to install</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-200">
          Scan with your phone’s <strong className="font-semibold text-ink-50">Camera</strong> app, then follow the steps
          on your phone.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-ink-300">
          Use the Camera app, not the Code Scanner. That opens a preview that can’t install.
        </p>
      </div>
    </section>
  )
}

function OtherDevices({ platform, installUrl }: { platform: PlatformInfo; installUrl: string }) {
  const current = deviceKind(platform)
  const [tab, setTab] = useState<DeviceKind>(current === 'ios' ? 'android' : 'ios')
  const guide = deviceGuide(tab)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = DEVICE_TABS.findIndex((t) => t.id === tab)
    const next = DEVICE_TABS[(i + (e.key === 'ArrowRight' ? 1 : DEVICE_TABS.length - 1)) % DEVICE_TABS.length]
    setTab(next.id)
    document.getElementById(`install-tab-${next.id}`)?.focus()
  }

  return (
    <section
      className="grid grid-cols-1 gap-6 border-t border-ink-600 py-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16 lg:py-20"
      aria-labelledby="other-devices"
    >
      <div className="min-w-0">
        <h2 id="other-devices" className="text-display text-2xl font-semibold tracking-[-0.03em] text-ink-50">
          Installing on another device?
        </h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-200">
          Send yourself this page, open it on that device and follow the steps.
        </p>
        <InstallLinkActions className="mt-5 max-w-md" url={installUrl} />
      </div>

      <div className="card min-w-0 overflow-hidden self-start">
        <IndicatorGroup id="install-device-tabs">
        <div role="tablist" aria-label="Device" className="flex border-b border-ink-600 bg-ink-850" onKeyDown={onKeyDown}>
          {DEVICE_TABS.map(({ id, label, icon: Icon }) => {
            const selected = tab === id
            return (
              <button
                key={id}
                id={`install-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="install-tabpanel"
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(id)}
                className={classNames(
                  // min-w-0 + 12px on the narrowest phones: three labels share 288px at 320.
                  'pressable relative flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 px-1.5 text-xs font-medium whitespace-nowrap min-[380px]:px-2 min-[380px]:text-sm',
                  selected ? 'text-ink-50' : 'text-ink-300 hover:text-ink-100',
                )}
              >
                <Icon size={14} weight={selected ? 'fill' : 'regular'} aria-hidden className="max-sm:hidden" />
                {label}
                {/* Glides to the chosen tab; instant from the arrow keys. */}
                {selected && (
                  <LayoutIndicator layoutId="device-tab" radius={1} className="absolute inset-x-3 bottom-0 h-0.5 bg-brand-600 dark:bg-brand-400" />
                )}
              </button>
            )
          })}
        </div>
        </IndicatorGroup>
        <div
          id="install-tabpanel"
          role="tabpanel"
          aria-labelledby={`install-tab-${tab}`}
          className="p-5"
          key={tab}
        >
          <p className="text-sm text-ink-200">
            <Emphasis text={guide.intro} />
          </p>
          <InstallSteps className="mt-4" steps={guide.steps} compact />
          {guide.note && <Note text={guide.note} />}
        </div>
      </div>
    </section>
  )
}

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Do I need an app store?',
    a: 'No. DeskDev installs straight from your browser. There’s nothing to download from the App Store or Google Play.',
  },
  {
    q: 'How does it update?',
    a: 'By itself. New versions load in the background, and DeskDev offers to refresh when one is ready. You never reinstall.',
  },
  {
    q: 'Why do I have to sign in again on iPhone?',
    a: 'Home Screen apps on iPhone and iPad keep their own storage, separate from Safari. Sign in once inside the app and it stays signed in.',
  },
  {
    q: 'What about password-reset and other email links?',
    a: 'Links in emails open in your browser, not in the app. Finish there (for example, set your new password), then return to the app.',
  },
  {
    q: 'How do I get notifications?',
    a: 'Open the installed app and turn them on in **Settings → Notifications**. On iPhone and iPad this needs iOS 16.4 or later and works only in the installed app, not in Safari.',
  },
  {
    q: 'How do I remove it?',
    a: 'On a phone, touch and hold the DeskDev icon and choose **Remove App** (iPhone, iPad) or **Uninstall** (Android). On a computer, open DeskDev’s window menu and choose **Uninstall**.',
  },
]

/**
 * Every answer in view (no accordion to open one by one): question and answer
 * side by side, ruled by hairlines.
 */
function Faq() {
  return (
    <section
      className="grid grid-cols-1 gap-6 border-t border-ink-600 py-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16 lg:py-20"
      aria-labelledby="install-faq"
    >
      <h2 id="install-faq" className="text-display text-2xl font-semibold tracking-[-0.03em] text-ink-50">
        Questions
      </h2>
      <dl className="min-w-0 divide-y divide-ink-600 border-b border-ink-600 lg:-mt-5">
        {FAQ.map(({ q, a }) => (
          <div key={q} className="py-5">
            <dt className="text-sm font-medium text-ink-50">{q}</dt>
            <dd className="mt-1.5 text-sm leading-relaxed text-ink-200 text-pretty">
              <Emphasis text={a} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
