import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CaretRightIcon, EyeSlashIcon, HouseIcon, ImagesIcon, LinkBreakIcon, MagnifyingGlassIcon, PlusIcon, StarIcon,
  WarningIcon, XIcon,
} from '@phosphor-icons/react'
import Layout from '../components/Layout'
import EmptyState from '../components/EmptyState'
import { SkeletonBlock, SkeletonLine } from '../components/ui-foundation'
import { IndicatorGroup, LayoutIndicator, useStagger } from '../components/motion'
import { Notice } from '../components/settings/formKit'
import ShowcaseItemModal from '../components/showcase/ShowcaseItemModal'
import {
  ConsentBadge, KIND_LABELS, ShowcaseStatusBadge, ShowcaseThumb, STATUS_LABELS,
} from '../components/showcase/showcaseBits'
import { matchesSearch, statusCounts, type StatusFilter } from '../components/showcase/showcaseForm'
import { useStore, useCurrentUser } from '../store/useStore'
import { can } from '../lib/permissions'
import { compareShowcase, publishChecklist } from '../lib/showcase'
import { classNames } from '../lib/format'
import type { ShowcaseItem } from '../lib/types'

// The review queue leads: "Needs review" is what an admin opens this page for.
const TABS: [StatusFilter, string][] = [
  ['all', 'All'],
  ['ready', STATUS_LABELS.ready],
  ['draft', STATUS_LABELS.draft],
  ['published', STATUS_LABELS.published],
  ['hidden', STATUS_LABELS.hidden],
  ['archived', STATUS_LABELS.archived],
]

// One ruled list: picture and title · status · consent · order · caret.
// Phones: the item spans the row and its badges sit under the title.
const ROW_GRID =
  'grid-cols-[minmax(0,1fr)_1.25rem] md:grid-cols-[minmax(0,1fr)_8rem_9rem_4rem_1.25rem]'

function ListSkeleton() {
  return (
    <div className="card overflow-hidden" role="status" aria-busy="true" aria-label="Loading showcase">
      <div className="hidden h-9 border-b border-ink-600 md:block" />
      <div className="divide-y divide-ink-600">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={classNames('grid items-center gap-4 px-4 py-3', ROW_GRID)}>
            <div className="flex min-w-0 items-center gap-3">
              <SkeletonBlock w={72} h={45} rounded="md" />
              <div className="flex-1 space-y-2">
                <SkeletonLine w={i % 2 ? '44%' : '58%'} />
                <SkeletonLine w="30%" className="h-3" />
              </div>
            </div>
            <SkeletonBlock w={84} h={20} rounded="md" className="hidden md:block" />
            <SkeletonBlock w={72} h={20} rounded="md" className="hidden md:block" />
            <SkeletonLine w={24} className="hidden h-3 justify-self-end md:block" />
            <span />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Showcase() {
  const [searchParams, setSearchParams] = useSearchParams()
  const user = useCurrentUser()
  const items = useStore((s) => s.showcaseItems)
  const hydrated = useStore((s) => s.hydrated)
  const canEdit = can(user, 'showcase', 'edit')

  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<StatusFilter>('all')
  const [creating, setCreating] = useState(false)

  // The open item is URL state: notifications and pushes link to ?item=<id>,
  // and the browser's back button closes the editor.
  const itemId = searchParams.get('item')
  const selected = itemId ? items.find((i) => i.id === itemId) : undefined
  // A link to an item that is gone (deleted, or not visible to this person).
  const missing = Boolean(itemId) && hydrated && !selected

  const openItem = useCallback((id: string, replace = false) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('item', id)
      return next
    }, { replace })
  }, [setSearchParams])

  const closeItem = useCallback(() => {
    setCreating(false)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('item')
      return next
    }, { replace: true })
  }, [setSearchParams])

  const sorted = useMemo(() => [...items].sort(compareShowcase), [items])
  const base = useMemo(() => sorted.filter((i) => matchesSearch(i, search)), [sorted, search])
  const counts = useMemo(() => statusCounts(base), [base])
  const visible = tab === 'all' ? base : base.filter((i) => i.status === tab)
  const published = useMemo(() => items.filter((i) => i.status === 'published').length, [items])

  // First load of the list this session: rows arrive 40ms apart, once.
  const { ref: attachStagger, className: staggerClass } = useStagger<HTMLUListElement>('showcase-list')

  const newButton = canEdit ? (
    <button className="btn-primary justify-center pointer-coarse:min-h-11" onClick={() => setCreating(true)}>
      <PlusIcon size={16} aria-hidden />
      New item
    </button>
  ) : null

  return (
    <Layout
      title="Showcase"
      subtitle={`${items.length} ${items.length === 1 ? 'item' : 'items'}, ${published} published`}
    >
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <MagnifyingGlassIcon
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
              aria-hidden
            />
            <input
              type="search"
              className="input w-full pl-9"
              placeholder="Search title, industry or stack…"
              aria-label="Search showcase items"
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {newButton}
        </div>

        <IndicatorGroup id="showcase-status">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="group" aria-label="Filter by status">
            {TABS.map(([value, label]) => {
              const active = tab === value
              return (
                <button
                  key={value}
                  aria-pressed={active}
                  className={classNames(
                    'chip pressable relative min-h-8 whitespace-nowrap px-3 pointer-coarse:min-h-11 pointer-coarse:px-3.5',
                    active
                      ? 'border-transparent text-brand-700 dark:text-brand-300'
                      : 'border-ink-600 text-ink-200 hover:border-ink-500 hover:text-ink-50',
                  )}
                  onClick={() => setTab(value)}
                >
                  {active && (
                    <LayoutIndicator
                      layoutId="showcase-status"
                      radius={999}
                      className="absolute -inset-px border border-brand-500/35 bg-brand-500/12"
                    />
                  )}
                  <span className="relative inline-flex items-center gap-1.5">
                    {label}
                    <span className="text-[11px] tabular-nums opacity-75">{counts[value]}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </IndicatorGroup>

        {missing && (
          <Notice
            tone="warn"
            icon={WarningIcon}
            live
            action={
              <button
                type="button"
                className="pressable tap-target -m-1 shrink-0 rounded-md p-1 text-ink-300 hover:text-ink-50"
                aria-label="Dismiss"
                onClick={closeItem}
              >
                <XIcon size={14} aria-hidden />
              </button>
            }
          >
            That showcase item is not here. It may have been deleted.
          </Notice>
        )}

        {!hydrated ? (
          <ListSkeleton />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={items.length === 0 ? ImagesIcon : undefined}
            glyph={items.length === 0 ? undefined : 'search-empty'}
            title={items.length === 0 ? 'No showcase items yet' : 'No items match'}
            description={
              items.length === 0
                ? 'Mark a project done with a live link and its draft lands here. You can also add one by hand.'
                : 'Try a different search or status.'
            }
            action={items.length === 0 ? newButton ?? undefined : undefined}
          />
        ) : (
          <div className="card overflow-hidden">
            <div
              className={classNames('section-title hidden gap-4 border-b border-ink-600 px-4 py-2.5 text-[11px] md:grid', ROW_GRID)}
              aria-hidden
            >
              <span>Item</span>
              <span>Status</span>
              <span>Consent</span>
              <span className="text-right">Order</span>
              <span />
            </div>
            <ul ref={attachStagger} className={classNames('divide-y divide-ink-600', staggerClass)}>
              {visible.map((item) => (
                <ShowcaseRow key={item.id} item={item} onOpen={openItem} />
              ))}
            </ul>
          </div>
        )}
      </div>

      <ShowcaseItemModal
        open={creating || Boolean(selected)}
        itemId={creating ? null : selected?.id ?? null}
        onClose={closeItem}
        onCreated={(id) => {
          setCreating(false)
          openItem(id, true)
        }}
      />
    </Layout>
  )
}

function ShowcaseRow({ item, onOpen }: { item: ShowcaseItem; onOpen: (id: string) => void }) {
  const meta = [KIND_LABELS[item.kind], item.industry].filter(Boolean).join(' · ')
  // How far a draft is from publishable, at a glance (the editor lists what is missing).
  const checklist = item.status === 'draft' || item.status === 'ready' ? publishChecklist(item) : null
  const checked = checklist ? checklist.filter((c) => c.ok).length : 0
  const flags = (
    <>
      {checklist && (
        <span
          className={classNames(
            'inline-flex items-center gap-1 text-[11px] tabular-nums',
            checked === checklist.length ? 'text-emerald-700 dark:text-emerald-400' : 'text-ink-300',
          )}
        >
          {checked}/{checklist.length} checks
        </span>
      )}
      {item.featured && (
        <span className="inline-flex items-center gap-1 text-[11px] text-ink-300">
          <StarIcon size={12} weight="fill" className="text-amber-600 dark:text-amber-400" aria-hidden />
          Featured
        </span>
      )}
      {item.homeFeatured && (
        <span className="inline-flex items-center gap-1 text-[11px] text-ink-300">
          <HouseIcon size={12} aria-hidden />
          Home
        </span>
      )}
      {!item.linkPublic && (
        <span className="inline-flex items-center gap-1 text-[11px] text-ink-300">
          <EyeSlashIcon size={12} aria-hidden />
          Link private
        </span>
      )}
      {item.linkStatus === 'down' && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700 dark:text-rose-400">
          <LinkBreakIcon size={12} aria-hidden />
          Link down, off the site
        </span>
      )}
    </>
  )
  return (
    <li>
      {/* The whole row opens the editor. A ruled row can't scale without its
          hairlines shifting, so its press is a deeper tint. */}
      <button
        type="button"
        onClick={() => onOpen(item.id)}
        className={classNames(
          'group grid w-full items-center gap-x-4 gap-y-2 px-4 py-3 text-left',
          'transition-colors duration-150 ease-[ease] hover:bg-ink-700/40 active:bg-ink-700/70',
          'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 focus-visible:ring-offset-0',
          ROW_GRID,
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <ShowcaseThumb item={item} className="w-[72px]" />
          <span className="min-w-0 flex-1">
            <span dir="auto" className="block truncate text-sm font-medium text-ink-50">{item.title}</span>
            <span className="mt-0.5 block truncate text-xs text-ink-300">{meta}</span>
            <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 empty:hidden">{flags}</span>
            {/* Phones: status and consent ride under the title. */}
            <span className="mt-2 flex flex-wrap items-center gap-1.5 md:hidden">
              <ShowcaseStatusBadge status={item.status} />
              <ConsentBadge consent={item.consent} />
            </span>
          </span>
        </span>
        <span className="hidden md:block"><ShowcaseStatusBadge status={item.status} /></span>
        <span className="hidden md:block"><ConsentBadge consent={item.consent} /></span>
        <span className="hidden text-right text-sm tabular-nums text-ink-200 md:block">{item.sortOrder}</span>
        <CaretRightIcon size={14} className="justify-self-end text-ink-400 group-hover:text-ink-200" aria-hidden />
      </button>
    </li>
  )
}
