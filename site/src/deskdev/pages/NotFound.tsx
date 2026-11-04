import { Link } from 'react-router-dom'
import { ArrowLeftIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import Layout from '../components/Layout'
import { Glyph } from '../components/ui-foundation'
import { OPEN_EVENT } from '../components/ui-foundation/CommandPalette'

/**
 * The in-app 404. No card: a composed, left-aligned block on the page — the
 * status code as a quiet mono eyebrow, the sentence carrying the weight, and
 * two ways on: home, or search for whatever the old link pointed at. It
 * arrives with the route fade like any page.
 */
export default function NotFound() {
  return (
    <Layout title="Not found">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-md pt-6 md:pt-16">
          <div className="flex items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-ink-600 bg-ink-800 text-ink-300 shadow-(--shadow-2) dark:bg-ink-700/60">
              <Glyph name="search-empty" size={22} />
            </div>
            <div className="font-mono text-sm tabular-nums text-ink-300">404</div>
          </div>
          <h2 className="mt-5 text-display text-2xl font-semibold text-ink-50">This page doesn&apos;t exist</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-200 text-pretty">
            The link may be outdated, or the item was moved or deleted.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Link to="/" className="btn-primary pointer-coarse:min-h-[44px]">
              <ArrowLeftIcon size={14} aria-hidden />
              Back home
            </Link>
            {/* Dispatched inside the click, so the palette can raise the iOS keyboard. */}
            <button
              type="button"
              className="btn-ghost pointer-coarse:min-h-[44px]"
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT))}
            >
              <MagnifyingGlassIcon size={14} aria-hidden />
              Search DeskDev
            </button>
          </div>
        </div>
      </div>
    </Layout>
  )
}
