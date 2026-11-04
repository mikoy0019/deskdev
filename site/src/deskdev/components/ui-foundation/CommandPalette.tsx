import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  AddressBookIcon, ArrowDownIcon, ArrowElbowDownLeftIcon, ArrowUpIcon, BellIcon, BriefcaseIcon,
  CalendarBlankIcon, ChatCircleIcon, CheckSquareIcon, CubeIcon, DownloadSimpleIcon, FilmStripIcon, GearIcon, RobotIcon, ScribbleIcon, GraduationCapIcon,
  HashIcon, type Icon, ImagesIcon, ListChecksIcon, LockIcon, MagnifyingGlassIcon, MoonIcon, PaperPlaneTiltIcon, PlusIcon,
  RowsIcon, SignOutIcon, SquaresFourIcon, SunIcon, TableIcon, TrendUpIcon, UsersIcon, VideoCameraIcon,
} from '@phosphor-icons/react'
import { useStore, useCurrentUser } from '../../store/useStore'
import { useTheme } from '../../theme/ThemeContext'
import { useDensity } from './DensityProvider'
import { classNames } from '../../lib/format'
import { searchEntities, HIT_ICONS } from '../../lib/search'
import { canViewChannel } from '../../lib/channels'
import { can } from '../../lib/permissions'
import type { PermFeature } from '../../lib/types'
import { useIsStandalone } from '../../pwa/useMediaQuery'
import { isLabelPrefix, scoreCommand } from './commandScore'
import { readGuideMemory, showSetupGuide } from '../home/setupGuideMemory'

/**
 * Global Ctrl/Cmd+K command palette — the power-user spine.
 * Open it three ways: the keyboard shortcut, the exported <KbdHint/> chip
 * (dispatches OPEN_EVENT), or any code firing that same window event.
 *
 * Groups: Navigate (every route), Create (quick-create affordances),
 * Preferences (theme + density) and Account (log out). Quick-create routes
 * carry `?new=1` — stage-2 pages read that flag to auto-open their create modal.
 */

export const OPEN_EVENT = 'deskdev:open-command-palette'

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)

type CommandGroup = 'Records' | 'Navigate' | 'Create' | 'Preferences' | 'Account'

/** The shortcut as the keycap reads it: one glyph on a Mac, two words elsewhere. */
const SHORTCUT_LABEL = IS_MAC ? '⌘K' : 'Ctrl K'

interface Command {
  id: string
  group: CommandGroup
  label: string
  hint?: string
  icon: Icon
  keywords?: string
  run: () => void
}

/**
 * The single search affordance in the Topbar: an input-styled button that opens
 * the command palette (which now searches records AND actions). Replaces the old
 * pair of a live-search input + a separate ⌘K chip.
 */
export function SearchTrigger({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT))}
      aria-label="Search records, actions and pages"
      className={classNames(
        'input flex items-center gap-2 w-36 sm:w-56 lg:w-72 text-ink-400',
        'hover:border-ink-500 transition-colors duration-150 ease-[ease]',
        className,
      )}
    >
      <MagnifyingGlassIcon size={14} className="shrink-0" aria-hidden />
      <span className="flex-1 text-left truncate">Search…</span>
      <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-ink-700 border border-ink-600 text-ink-200 font-mono text-[10px] leading-none">
        {SHORTCUT_LABEL}
      </kbd>
    </button>
  )
}

/** The ⌘K hint chip for the Topbar. Opens the palette via the window event. */
export function KbdHint({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT))}
      aria-label="Open command palette"
      className={classNames(
        'hidden sm:inline-flex items-center gap-1.5 h-8 pl-2.5 pr-1.5 rounded-lg',
        'border border-ink-600 bg-ink-800 text-ink-300 text-xs font-medium',
        'hover:text-ink-100 hover:border-ink-500 transition-colors duration-150 ease-[ease]',
        className,
      )}
    >
      <MagnifyingGlassIcon size={13} aria-hidden />
      <span className="hidden md:inline">Search</span>
      <kbd className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-ink-700 border border-ink-600 text-ink-200 font-mono text-[10px] leading-none">
        {SHORTCUT_LABEL}
      </kbd>
    </button>
  )
}

// What had focus when the palette opened: closing hands it back, so a
// keyboard user is not dropped on <body> (or out of the dialog underneath).
// Module state, not a ref: the palette is mounted once, and `close` is handed
// to every command.
let opener: HTMLElement | null = null

export default function CommandPalette() {
  const navigate = useNavigate()
  const { isDark, setMode } = useTheme()
  const { density, toggleDensity } = useDensity()
  const clients = useStore((s) => s.clients)
  const projects = useStore((s) => s.projects)
  const tasks = useStore((s) => s.tasks)
  const events = useStore((s) => s.events)
  const crmTables = useStore((s) => s.crmTables)
  const channels = useStore((s) => s.channels)
  const logout = useStore((s) => s.logout)
  const me = useCurrentUser()
  const standalone = useIsStandalone()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setActive(0)
    const from = opener
    opener = null
    if (from && from !== document.body && document.contains(from)) from.focus({ preventScroll: true })
  }, [])

  const go = useCallback(
    (to: string) => {
      navigate(to)
      close()
    },
    [navigate, close],
  )

  const commands = useMemo<Command[]>(() => {
    // Feature-gated pages only appear for people who can open them — the
    // sidebar already hides them, and the palette must agree with it.
    const gated = (feature: PermFeature, cmd: Command): Command[] => (can(me, feature, 'view') ? [cmd] : [])
    const nav: Command[] = [
      { id: 'nav-home', group: 'Navigate', label: 'Home', hint: 'Dashboard', icon: SquaresFourIcon, keywords: 'dashboard overview', run: () => go('/') },
      { id: 'nav-cube', group: 'Navigate', label: 'Cube', hint: 'Operational decisions', icon: CubeIcon, keywords: 'departments operations decisions playbooks approvals', run: () => go('/cube') },
      ...gated('projects', { id: 'nav-projects', group: 'Navigate', label: 'Projects', icon: BriefcaseIcon, keywords: 'list pipeline', run: () => go('/projects') }),
      ...gated('tasks', { id: 'nav-tasks', group: 'Navigate', label: 'Tasks', icon: CheckSquareIcon, keywords: 'todo kanban', run: () => go('/tasks') }),
      ...gated('clients', { id: 'nav-clients', group: 'Navigate', label: 'Clients', icon: UsersIcon, keywords: 'customers accounts', run: () => go('/clients') }),
      ...gated('crm', { id: 'nav-crm', group: 'Navigate', label: 'CRM', icon: TableIcon, keywords: 'tables leads', run: () => go('/crm') }),
      ...gated('calendar', { id: 'nav-calendar', group: 'Navigate', label: 'Calendar', icon: CalendarBlankIcon, keywords: 'schedule events', run: () => go('/calendar') }),
      ...gated('meetings', { id: 'nav-meetings', group: 'Navigate', label: 'Meetings', icon: VideoCameraIcon, keywords: 'calls', run: () => go('/meetings') }),
      { id: 'nav-assistant', group: 'Navigate', label: 'Ask the Assistant', icon: RobotIcon, keywords: 'chat bot help question summary', run: () => go('/assistant') },
      { id: 'nav-whiteboard', group: 'Navigate', label: 'Whiteboard', icon: ScribbleIcon, keywords: 'draw sketch excalidraw diagram board', run: () => go('/whiteboard') },
      ...gated('meetings', { id: 'nav-recordings', group: 'Navigate', label: 'Meeting Recordings', icon: FilmStripIcon, keywords: 'recordings video loom zoom replay', run: () => go('/recordings') }),
      ...gated('growth', { id: 'nav-growth', group: 'Navigate', label: 'Growth Hub', icon: TrendUpIcon, keywords: 'sales growth revenue dashboard', run: () => go('/growth') }),
      ...gated('growth', { id: 'nav-growth-leads', group: 'Navigate', label: 'CRM Leads', icon: AddressBookIcon, keywords: 'growth leads pipeline sales crm', run: () => go('/growth/leads') }),
      ...gated('growth', { id: 'nav-growth-outbound', group: 'Navigate', label: 'Outbound Command', icon: PaperPlaneTiltIcon, keywords: 'growth outreach campaigns cold email', run: () => go('/growth/outbound') }),
      ...gated('showcase', { id: 'nav-showcase', group: 'Navigate', label: 'Showcase', icon: ImagesIcon, keywords: 'portfolio work case studies', run: () => go('/showcase') }),
      ...gated('courses', { id: 'nav-courses', group: 'Navigate', label: 'Courses', icon: GraduationCapIcon, keywords: 'training sop videos library', run: () => go('/courses') }),
      ...(me?.role === 'admin'
        ? [{ id: 'nav-vault', group: 'Navigate' as const, label: 'Vault', icon: LockIcon, keywords: 'passwords credentials secrets', run: () => go('/vault') }]
        : []),
      { id: 'nav-messages', group: 'Navigate', label: 'Messages', icon: ChatCircleIcon, keywords: 'chat inbox dm conversation', run: () => go('/messages') },
      { id: 'nav-channels', group: 'Navigate', label: 'Channels', icon: HashIcon, keywords: 'discord rooms team chat', run: () => go('/channels') },
      // Every channel you can see is one jump away: type "#gen" or "general".
      ...channels
        .filter((c) => canViewChannel(c, me))
        .map<Command>((c) => ({
          id: `nav-channel-${c.id}`,
          group: 'Navigate',
          label: `#${c.name}`,
          hint: 'Channel',
          icon: HashIcon,
          keywords: `channel ${c.topic ?? ''}`,
          run: () => go(`/channels/${c.id}`),
        })),
      { id: 'nav-notifications', group: 'Navigate', label: 'Notifications', icon: BellIcon, keywords: 'alerts activity', run: () => go('/notifications') },
      // Installing happens from a browser tab; inside the installed app it's done.
      ...(standalone
        ? []
        : [{ id: 'nav-install', group: 'Navigate' as const, label: 'Install app', icon: DownloadSimpleIcon, keywords: 'phone home screen download desktop', run: () => go('/install') }]),
      { id: 'nav-settings', group: 'Navigate', label: 'Settings', icon: GearIcon, keywords: 'preferences admin users', run: () => go('/settings') },
    ]
    const creatable = (feature: PermFeature, cmd: Command): Command[] => (can(me, feature, 'edit') ? [cmd] : [])
    const create: Command[] = [
      ...creatable('clients', { id: 'new-client', group: 'Create', label: 'New client', icon: PlusIcon, keywords: 'add create customer', run: () => go('/clients?new=1') }),
      ...creatable('projects', { id: 'new-project', group: 'Create', label: 'New project', icon: PlusIcon, keywords: 'add create', run: () => go('/projects?new=1') }),
      ...creatable('tasks', { id: 'new-task', group: 'Create', label: 'New task', icon: PlusIcon, keywords: 'add create todo', run: () => go('/tasks?new=1') }),
      ...creatable('meetings', { id: 'new-meeting', group: 'Create', label: 'New meeting', icon: PlusIcon, keywords: 'add create schedule call', run: () => go('/meetings?new=1') }),
      { id: 'new-whiteboard', group: 'Create', label: 'New whiteboard', icon: PlusIcon, keywords: 'draw sketch board diagram', run: () => go('/whiteboard?new=1') },
      ...creatable('meetings', { id: 'new-recording', group: 'Create', label: 'Add a recording', icon: PlusIcon, keywords: 'recording video link loom', run: () => go('/recordings?new=1') }),
      ...creatable('crm', { id: 'new-table', group: 'Create', label: 'New CRM table', icon: PlusIcon, keywords: 'add create crm', run: () => go('/crm?new=1') }),
      { id: 'new-channel', group: 'Create', label: 'New channel', icon: PlusIcon, keywords: 'add create room discord', run: () => go('/channels?new=1') },
    ]
    const prefs: Command[] = [
      {
        id: 'toggle-theme',
        group: 'Preferences',
        label: isDark ? 'Switch to light theme' : 'Switch to dark theme',
        icon: isDark ? SunIcon : MoonIcon,
        keywords: 'theme dark light appearance mode',
        run: () => {
          setMode(isDark ? 'light' : 'dark')
          close()
        },
      },
      {
        id: 'toggle-density',
        group: 'Preferences',
        label: density === 'compact' ? 'Comfortable density' : 'Compact density',
        icon: RowsIcon,
        keywords: 'density compact comfortable spacing rows',
        run: () => {
          toggleDensity()
          close()
        },
      },
    ]
    // Hide on the setup guide is per device and had no way back: offered to
    // admins while it is hidden and unfinished (read when the palette opens).
    const guide = open && me?.role === 'admin' ? readGuideMemory(me.id) : null
    if (me && guide?.hidden && !guide.finished) {
      prefs.push({
        id: 'show-setup-guide',
        group: 'Preferences',
        label: 'Show setup guide',
        icon: ListChecksIcon,
        keywords: 'onboarding getting started first run checklist steps',
        run: () => {
          showSetupGuide(me.id)
          go('/')
        },
      })
    }
    const account: Command[] = [
      {
        id: 'log-out',
        group: 'Account',
        label: 'Log out',
        icon: SignOutIcon,
        keywords: 'sign out signout logout exit',
        run: () => {
          close()
          void logout()
        },
      },
    ]
    return [...nav, ...create, ...prefs, ...account]
  }, [go, isDark, setMode, density, toggleDensity, close, channels, me, standalone, logout, open])

  // Live record matches (clients/projects/tasks/events/CRM) — the folded-in
  // entity search. Already substring-filtered, so they skip fuzzyScore and lead
  // the results when the query is non-empty.
  const recordCommands = useMemo<Command[]>(() => {
    if (!query.trim()) return []
    return searchEntities(query, { clients, projects, tasks, events, crmTables }).map((h) => ({
      id: `rec-${h.kind}-${h.id}`,
      group: 'Records',
      label: h.title,
      hint: h.sub,
      icon: HIT_ICONS[h.kind],
      run: () => go(h.to),
    }))
  }, [query, clients, projects, tasks, events, crmTables, go])

  // Label matches lead, keywords only help (commandScore). The sort is
  // stable, so equal scores keep the order the commands are declared in.
  const results = useMemo(() => {
    return commands
      .map((c) => ({ c, s: scoreCommand(query, c.label, c.keywords) }))
      .filter((x): x is { c: Command; s: number } => x.s !== null)
      .sort((a, b) => a.s - b.s)
  }, [commands, query])

  // Grouped view. With no query the groups keep their fixed order. With one,
  // the group holding the best match comes first, so Enter runs the best
  // match and not the first row of whichever group happens to be on top.
  // Records lead unless an action's own name starts with what was typed
  // ("tasks" opens Tasks, not a record with "tasks" somewhere in its title).
  const grouped = useMemo(() => {
    const order: CommandGroup[] = ['Navigate', 'Create', 'Preferences', 'Account']
    const sections: { group: CommandGroup; items: Command[]; best: number }[] = []
    for (const g of order) {
      const items = results.filter((x) => x.c.group === g)
      if (items.length === 0) continue
      sections.push({ group: g, items: items.map((x) => x.c), best: items[0].s })
    }
    if (query.trim()) sections.sort((a, b) => a.best - b.best)
    if (recordCommands.length > 0) {
      const records = { group: 'Records' as const, items: recordCommands, best: 0 }
      const lead = sections.findIndex((sec) => !isLabelPrefix(sec.best))
      sections.splice(lead === -1 ? sections.length : lead, 0, records)
    }
    return { sections, flat: sections.flatMap((sec) => sec.items) }
  }, [results, recordCommands, query])

  // The listeners below are bound once; they read the open state from here.
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  // Global open shortcut + custom event.
  useEffect(() => {
    const remember = () => {
      if (!openRef.current) opener = document.activeElement as HTMLElement | null
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        if (openRef.current) {
          close()
          return
        }
        show()
      }
    }
    // Render now and focus the input before the handler returns. A trigger's
    // tap: the only way iOS will raise the keyboard (the event is dispatched
    // inside the click). The shortcut: whatever is typed straight after
    // Ctrl+K lands in the search field, not on the page behind it.
    const show = () => {
      remember()
      flushSync(() => setOpen(true))
      inputRef.current?.focus()
    }
    const onOpen = () => show()
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_EVENT, onOpen)
    }
  }, [close])

  // Focus input + lock body scroll while open.
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(t)
      document.body.style.overflow = prev
    }
  }, [open])

  // The palette is the top layer while it is open, also over a dialog. Its
  // Escape and Tab are taken in the capture phase, before any listener on
  // the document: one Escape used to close the palette AND the dialog under
  // it (a New task form with typed content gone), because the dialog's
  // document listener saw the same key.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      } else if (e.key === 'Tab' && !panelRef.current?.contains(document.activeElement)) {
        // Focus drifted out (a click on the list's padding): Tab brings it back.
        e.preventDefault()
        e.stopPropagation()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, close])

  // The highlighted row, clamped as the result list shrinks under it.
  const current = Math.min(active, Math.max(0, grouped.flat.length - 1))

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(grouped.flat.length ? (current + 1) % grouped.flat.length : 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(grouped.flat.length ? (current - 1 + grouped.flat.length) % grouped.flat.length : 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      grouped.flat[current]?.run()
    } else if (e.key === 'Tab') {
      // A modal dialog: Tab never walks out to the page under the scrim. Rows
      // are reached with the arrows; the only other control is phones' Cancel.
      // (Escape is taken by the capture listener above.)
      const cancel = e.currentTarget.parentElement?.querySelector<HTMLElement>('[data-palette-cancel]')
      e.preventDefault()
      e.stopPropagation()
      if (cancel && cancel.offsetParent !== null) cancel.focus()
    }
  }

  // Scroll the active row into view.
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${current}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [current, open])

  if (!open) return null

  return (
    <div
      // Phones: a full-screen sheet sized to the visible viewport (keyboard included).
      className="fixed inset-0 z-100 flex items-start justify-center p-4 sm:pt-[12vh] max-sm:p-0 max-sm:bottom-auto max-sm:h-(--app-h)"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* No open/close animation, ever: the palette is a 100+-a-day,
          keyboard-first surface (Emil / Raycast). It is simply there. The
          one plain scrim, as under every other overlay: no blur. */}
      <div className="scrim" onClick={close} aria-hidden />

      <div
        ref={panelRef}
        className={classNames(
          'relative w-full max-w-xl card shadow-(--shadow-3) overflow-hidden',
          'max-sm:h-full max-sm:max-w-none max-sm:rounded-none max-sm:border-0 max-sm:flex max-sm:flex-col max-sm:pt-(--safe-top)',
        )}
      >
        {/* Search input */}
        <div className="shrink-0 flex items-center gap-2.5 px-4 border-b border-ink-600">
          <MagnifyingGlassIcon size={16} className="text-ink-300 shrink-0" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onInputKey}
            placeholder="Search records, actions, pages…"
            className="flex-1 min-w-0 bg-transparent py-3.5 text-sm max-sm:text-base text-ink-50 placeholder:text-ink-300 focus:outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0"
            aria-label="Command search"
            // A combobox over the result list: focus stays in the input and
            // screen readers follow the highlighted row as the arrows move it.
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="dd-palette-list"
            aria-activedescendant={grouped.flat.length ? `dd-cmd-${current}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-md bg-ink-700 border border-ink-600 text-ink-300 font-mono text-[10px]">
            esc
          </kbd>
          {/* Touch has no Escape key, and the full-screen sheet leaves no scrim to tap. */}
          <button
            type="button"
            data-palette-cancel
            className="pressable sm:hidden shrink-0 -mr-2 h-[44px] px-2 text-sm font-medium text-brand-600 dark:text-brand-400"
            onClick={close}
            onKeyDown={(e) => {
              if (e.key !== 'Tab') return
              e.preventDefault()
              e.stopPropagation()
              inputRef.current?.focus()
            }}
          >
            Cancel
          </button>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          id="dd-palette-list"
          role={grouped.flat.length ? 'listbox' : undefined}
          aria-label={grouped.flat.length ? 'Results' : undefined}
          className="max-h-[52vh] overflow-y-auto overscroll-contain py-2 max-sm:max-h-none max-sm:flex-1 max-sm:min-h-0 max-sm:pb-[max(0.5rem,var(--safe-bottom))]"
        >
          {grouped.flat.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-ink-200">No commands match “{query}”.</p>
              <p className="mt-1 text-xs text-ink-300">Try a page name or “new”.</p>
            </div>
          ) : (
            grouped.sections.map((sec) => (
              <div key={sec.group} role="group" aria-labelledby={`dd-cmd-group-${sec.group}`} className="mb-1 last:mb-0">
                <div id={`dd-cmd-group-${sec.group}`} className="section-title px-4 pt-2 pb-1">{sec.group}</div>
                {sec.items.map((cmd) => {
                  const idx = grouped.flat.indexOf(cmd)
                  const isActive = idx === current
                  const Icon = cmd.icon
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      id={`dd-cmd-${idx}`}
                      role="option"
                      aria-selected={isActive}
                      // Rows are reached with the arrows, not Tab (focus stays in the input).
                      tabIndex={-1}
                      data-idx={idx}
                      onMouseMove={() => setActive(idx)}
                      onClick={() => cmd.run()}
                      // The highlight moves instantly — arrow keys drive it.
                      // A tap gets its feedback on press-down (tint, no scale
                      // in a dense list).
                      className={classNames(
                        'w-full flex items-center gap-3 px-4 py-2 pointer-coarse:min-h-12 text-left [-webkit-touch-callout:none] active:bg-brand-600/20',
                        isActive ? 'bg-brand-600/15' : 'hover:bg-ink-700/60',
                      )}
                    >
                      <span
                        className={classNames(
                          'w-7 h-7 rounded-md flex items-center justify-center shrink-0 border',
                          isActive
                            ? 'bg-brand-600/20 border-brand-600/30 text-brand-500 dark:text-brand-400'
                            : 'bg-ink-700 border-ink-600 text-ink-300',
                        )}
                      >
                        <Icon size={15} aria-hidden />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-ink-50 truncate" title={cmd.label}>{cmd.label}</span>
                        {cmd.hint && <span className="block text-xs text-ink-300 truncate" title={cmd.hint}>{cmd.hint}</span>}
                      </span>
                      {isActive && (
                        <ArrowElbowDownLeftIcon size={14} className="text-ink-300 shrink-0" aria-hidden />
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer legend */}
        <div className="max-sm:hidden flex items-center gap-4 px-4 py-2 border-t border-ink-600 text-[11px] text-ink-300">
          <LegendKey icon={<ArrowUpIcon size={11} aria-hidden />} label="/" second={<ArrowDownIcon size={11} aria-hidden />} text="Navigate" />
          <LegendKey icon={<ArrowElbowDownLeftIcon size={11} aria-hidden />} text="Select" />
          <span className="ml-auto font-mono text-[10px] text-ink-400">
            {SHORTCUT_LABEL}
          </span>
        </div>
      </div>
    </div>
  )
}

function LegendKey({
  icon,
  second,
  label,
  text,
}: {
  icon: ReactNode
  second?: ReactNode
  label?: string
  text: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-0.5 text-ink-200">
        {icon}
        {label}
        {second}
      </span>
      {text}
    </span>
  )
}
