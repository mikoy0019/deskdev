import { useState } from 'react'
import { toast } from 'sonner'
import {
  CheckIcon, CopyIcon, DotsThreeIcon, DotsThreeVerticalIcon, DownloadSimpleIcon, ExportIcon,
  GlobeIcon, HouseIcon, type Icon, ListIcon, PlusSquareIcon, ShareNetworkIcon,
} from '@phosphor-icons/react'
import { classNames } from '../../lib/format'
import {
  canShareLink,
  chromeIntentUrl,
  copyText,
  shareLink,
  splitEmphasis,
  type GuideGlyph,
  type GuideStep,
} from '../../pwa/installGuides'

/** Chrome's mark on a 24px icon grid (Phosphor's Chrome glyph is a monochrome outline). */
export function ChromeGlyph({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <path d="M21.17 8H12M3.95 6.06 8.54 14M10.88 21.94 15.46 14" />
    </svg>
  )
}

/** iOS's switch, in its on state — the "Open as Web App" toggle people look for. */
function ToggleGlyph() {
  return (
    <span className="relative block w-7 h-4 rounded-full bg-emerald-500" aria-hidden>
      <span className="absolute top-0.5 right-0.5 w-3 h-3 rounded-full bg-ink-800" />
    </span>
  )
}

const ICONS: Record<Exclude<GuideGlyph, 'toggle' | 'chrome'>, Icon> = {
  share: ExportIcon,
  'more-vert': DotsThreeVerticalIcon,
  'more-horiz': DotsThreeIcon,
  menu: ListIcon,
  'plus-square': PlusSquareIcon,
  install: DownloadSimpleIcon,
  home: HouseIcon,
  copy: CopyIcon,
  browser: GlobeIcon,
}

/** The control a step points at, drawn the way the browser draws it. */
export function StepGlyph({ glyph, size = 18 }: { glyph: GuideGlyph; size?: number }) {
  if (glyph === 'toggle') return <ToggleGlyph />
  if (glyph === 'chrome') return <ChromeGlyph size={size} />
  const Icon = ICONS[glyph]
  return <Icon size={size} aria-hidden />
}

/** Renders '**label**' runs as bold — the words to look for on screen. */
export function Emphasis({ text }: { text: string }) {
  return (
    <>
      {splitEmphasis(text).map((part, i) =>
        part.strong ? (
          <strong key={i} className="font-semibold text-ink-50">
            {part.text}
          </strong>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}

/** Numbered install steps, each with a picture of the button to tap. */
export default function InstallSteps({
  steps,
  compact,
  className,
}: {
  steps: GuideStep[]
  /** Tighter rows for Settings and the secondary tabs. */
  compact?: boolean
  className?: string
}) {
  return (
    <ol className={classNames(compact ? 'space-y-3' : 'space-y-4', className)}>
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-3">
          <span
            className={classNames(
              'relative shrink-0 flex items-center justify-center rounded-lg border border-ink-600 bg-ink-700 text-ink-50',
              compact ? 'w-9 h-9' : 'w-10 h-10',
            )}
          >
            <StepGlyph glyph={step.glyph} size={compact ? 16 : 18} />
            <span
              className="absolute -top-1.5 -left-1.5 min-w-5 h-5 px-1 rounded-full bg-brand-600 text-white text-[11px] font-semibold leading-5 text-center tabular-nums ring-2 ring-ink-800"
              aria-hidden
            >
              {i + 1}
            </span>
          </span>
          <p
            className={classNames(
              'min-w-0 flex-1 text-ink-200 leading-relaxed',
              compact ? 'pt-1.5 text-sm' : 'pt-2 text-sm',
            )}
          >
            <span className="sr-only">Step {i + 1}: </span>
            <Emphasis text={step.text} />
          </p>
        </li>
      ))}
    </ol>
  )
}

/**
 * The install link with Copy and (where the OS has a share sheet) Share — for
 * sending DeskDev to another device.
 */
export function InstallLinkActions({ url, className }: { url: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  // Feature detection, stable for the page's life — no need for state.
  const shareable = canShareLink()

  const copy = async () => {
    if (await copyText(url)) {
      setCopied(true)
      toast.success('Link copied')
      window.setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error('Couldn’t copy. Select the link and copy it by hand.')
    }
  }

  const share = async () => {
    if ((await shareLink(url)) === 'failed') toast.error('Couldn’t open the share sheet')
  }

  return (
    <div className={classNames('flex flex-col gap-2 sm:flex-row sm:items-center', className)}>
      {/* Plain selectable text, not a link: tapping it shouldn't navigate away. */}
      <span
        className="min-w-0 flex-1 truncate rounded-lg border border-ink-600 bg-ink-700/60 px-3 py-2 font-mono text-xs text-ink-200 select-all pointer-coarse:py-3"
        title={url}
      >
        {url}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary flex-1 sm:flex-none pointer-coarse:min-h-11"
          onClick={copy}
        >
          {/* The check pops in where the copy mark was (state change, 180ms). */}
          {copied ? (
            <CheckIcon size={14} className="animate-pop-in [--transform-origin:center]" aria-hidden />
          ) : (
            <CopyIcon size={14} aria-hidden />
          )}
          {copied ? 'Copied' : 'Copy link'}
        </button>
        {shareable && (
          <button
            type="button"
            className="btn-secondary flex-1 sm:flex-none pointer-coarse:min-h-11"
            onClick={share}
          >
            <ShareNetworkIcon size={14} aria-hidden />
            Share
          </button>
        )}
      </div>
    </div>
  )
}

/** Samsung, Firefox and Edge only make shortcuts — Chrome makes the real app. */
export function ChromeCallout({ installUrl, className }: { installUrl: string; className?: string }) {
  return (
    <div className={classNames('rounded-lg border border-brand-500/30 bg-brand-500/10 p-4', className)}>
      <p className="text-sm font-semibold text-ink-50">Chrome installs the full app</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-200">
        With notifications, an app-list entry and its own window. Open this page in Chrome to install it there.
      </p>
      <a href={chromeIntentUrl(installUrl)} className="btn-primary mt-3 w-full pointer-coarse:min-h-11 sm:w-auto">
        <ChromeGlyph size={16} />
        Open in Chrome
      </a>
    </div>
  )
}
