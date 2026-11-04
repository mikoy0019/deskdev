import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  BellIcon, BuildingsIcon, ClockCounterClockwiseIcon, DatabaseIcon, DesktopIcon, DeviceMobileIcon, type Icon, PaletteIcon,
  PlugIcon, TrendUpIcon, UserIcon, UsersIcon,
} from '@phosphor-icons/react'
import Layout from '../components/Layout'
import ConfirmDialog from '../components/ConfirmDialog'
import { UnsavedProvider } from '../components/settings/formKit'
import ProfileSection from '../components/settings/ProfileSection'
import AppearanceSection from '../components/settings/AppearanceSection'
import NotificationsSection from '../components/settings/NotificationsSection'
import WorkspaceSection from '../components/settings/WorkspaceSection'
import GrowthSection from '../components/settings/GrowthSection'
import UsersSection from '../components/settings/UsersSection'
import AuditSection from '../components/settings/AuditSection'
import DataSection from '../components/settings/DataSection'
import IntegrationsSection from '../components/settings/IntegrationsSection'
import MobileAppSection from '../components/settings/MobileAppSection'
import DesktopAppSection from '../components/settings/DesktopAppSection'
import { IndicatorGroup, LayoutIndicator } from '../components/motion'
import { useCurrentUser } from '../store/useStore'
import { classNames } from '../lib/format'
import { isSupabaseConfigured } from '../lib/supabase'

type SectionId =
  | 'profile'
  | 'appearance'
  | 'notifications'
  | 'integrations'
  | 'mobile'
  | 'desktop'
  | 'workspace'
  | 'growth'
  | 'users'
  | 'audit'
  | 'data'

const SECTIONS: {
  id: SectionId
  label: string
  icon: Icon
  adminOnly: boolean
}[] = [
  { id: 'profile', label: 'Profile', icon: UserIcon, adminOnly: false },
  { id: 'appearance', label: 'Appearance', icon: PaletteIcon, adminOnly: false },
  { id: 'notifications', label: 'Notifications', icon: BellIcon, adminOnly: false },
  { id: 'integrations', label: 'Integrations', icon: PlugIcon, adminOnly: false },
  { id: 'mobile', label: 'Mobile app', icon: DeviceMobileIcon, adminOnly: false },
  { id: 'desktop', label: 'Desktop app', icon: DesktopIcon, adminOnly: false },
  { id: 'workspace', label: 'Workspace', icon: BuildingsIcon, adminOnly: true },
  { id: 'growth', label: 'Growth', icon: TrendUpIcon, adminOnly: true },
  { id: 'users', label: 'Users', icon: UsersIcon, adminOnly: true },
  { id: 'audit', label: 'Audit log', icon: ClockCounterClockwiseIcon, adminOnly: true },
  { id: 'data', label: 'Data', icon: DatabaseIcon, adminOnly: true },
]

export default function Settings() {
  const user = useCurrentUser()
  const [params, setParams] = useSearchParams()

  // The open section lives in the URL (/settings?section=notifications): a
  // reload or a shared link lands where you were, and the inbox, the bell and
  // the Growth Hub deep-link straight to theirs. Replaced, not pushed, so
  // Back leaves Settings instead of stepping through every tab.
  const linked = SECTIONS.find((s) => s.id === params.get('section'))?.id

  const isAdmin = user?.role === 'admin'
  const visible = SECTIONS.filter((s) => isAdmin || !s.adminOnly)
  const wanted = linked ?? 'profile'
  const active = visible.some((s) => s.id === wanted) ? wanted : 'profile'
  const activeMeta = visible.find((s) => s.id === active) ?? visible[0]

  // Panels with unsaved edits report here (formKit's Panel `dirty`). Switching
  // section unmounts them, so it asks first instead of dropping the edits.
  const unsaved = useRef(new Set<string>())
  const reportUnsaved = useCallback((key: string, dirty: boolean) => {
    if (dirty) unsaved.current.add(key)
    else unsaved.current.delete(key)
  }, [])
  // Where the person was going when unsaved edits stopped them: another
  // section, or a link out of Settings (the sidebar, the tab bar, a link in a
  // panel).
  const [leavingFor, setLeavingFor] = useState<SectionId | HTMLAnchorElement | null>(null)

  // Leaving Settings altogether dropped the edits without a word. A reload or
  // a closed tab gets the browser's own question; a link inside the app gets
  // the same dialog as a section switch. (BrowserRouter has no useBlocker, so
  // the links are caught on the way down. Back and the command palette are
  // not links and still leave directly.)
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (unsaved.current.size === 0) return
      e.preventDefault()
      e.returnValue = ''
    }
    const onClick = (e: MouseEvent) => {
      if (unsaved.current.size === 0 || e.defaultPrevented) return
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return
      if (link.origin !== window.location.origin) return
      // The skip link and other in-page anchors go nowhere.
      if (link.pathname === window.location.pathname && link.search === window.location.search) return
      e.preventDefault()
      e.stopPropagation()
      setLeavingFor(link)
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [])

  const go = (id: SectionId) => {
    const next = new URLSearchParams(params)
    next.set('section', id)
    setParams(next, { replace: true })
  }
  const choose = (id: SectionId) => {
    if (id === active) return
    if (unsaved.current.size > 0) setLeavingFor(id)
    else go(id)
  }

  // On phones the tabs scroll sideways: keep the active one (e.g. a deep link
  // to 'mobile', far right) in view instead of off the edge.
  const activeTab = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeTab.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  return (
    <Layout title="Settings" subtitle="Profile, appearance, notifications & workspace">
      {/* Left-aligned to the page gutter, as every other screen. */}
      <div className="max-w-5xl">
        <div className="md:grid md:grid-cols-[11.5rem_minmax(0,1fr)] md:gap-10">
          {/* Sticky on desktop so the section list stays put down a long panel.
              top-0: the scroller's own top padding already sits above it, so
              the first item stays level with the section heading. */}
          <nav
            className="-mx-4 flex gap-1 overflow-x-auto overscroll-x-contain px-4 pb-3 pt-px [scrollbar-width:none] max-md:[mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-1rem),transparent)] md:sticky md:top-0 md:mx-0 md:flex-col md:self-start md:overflow-visible md:px-0 md:pb-0"
            aria-label="Settings sections"
          >
            <IndicatorGroup id="settings-nav">
              {visible.map(({ id, label, icon: Glyph }) => {
                const on = active === id
                return (
                  <button
                    key={id}
                    type="button"
                    ref={on ? activeTab : undefined}
                    aria-current={on ? 'true' : undefined}
                    className={classNames(
                      'pressable relative flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium pointer-coarse:min-h-11',
                      on ? 'text-ink-50' : 'text-ink-200 hover:bg-ink-700/50 hover:text-ink-50',
                    )}
                    onClick={() => choose(id)}
                  >
                    {/* The raised tab (hairline + shadow-1) glides to the new
                        section; the brand rail rides inside it on desktop. */}
                    {on && (
                      <LayoutIndicator
                        layoutId="settings-nav"
                        radius={6}
                        className="absolute inset-0 bg-ink-800 shadow-[0_0_0_1px_rgb(var(--ink-600)),var(--shadow-1)] dark:bg-ink-700/70 dark:shadow-[0_0_0_1px_rgb(var(--ink-600)/0.7)]"
                      />
                    )}
                    {on && (
                      <span aria-hidden className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-brand-500 max-md:hidden" />
                    )}
                    <Glyph
                      size={16}
                      weight={on ? 'fill' : 'regular'}
                      aria-hidden
                      className={classNames('relative', on ? 'text-brand-600 dark:text-brand-400' : 'text-ink-400')}
                    />
                    <span className="relative">{label}</span>
                  </button>
                )
              })}
            </IndicatorGroup>
          </nav>

          {/* Keyed by section: the panel arrives with the route fade (120ms
              opacity, none from the keyboard) instead of swapping in a frame. */}
          <div key={active} className="mt-3 min-w-0 animate-route md:mt-0">
            <h2 className="mb-5 text-display text-xl font-semibold text-ink-50 max-md:sr-only">{activeMeta.label}</h2>
            <UnsavedProvider value={reportUnsaved}>
              {active === 'profile' && <ProfileSection />}
              {active === 'appearance' && <AppearanceSection />}
              {active === 'notifications' && <NotificationsSection />}
              {active === 'integrations' && <IntegrationsSection />}
              {active === 'mobile' && <MobileAppSection onOpenNotifications={() => choose('notifications')} />}
              {active === 'desktop' && <DesktopAppSection />}
              {active === 'workspace' && isAdmin && <WorkspaceSection />}
              {active === 'growth' && isAdmin && <GrowthSection />}
              {active === 'users' && isAdmin && <UsersSection />}
              {active === 'audit' && isAdmin && <AuditSection />}
              {active === 'data' && isAdmin && <DataSection />}
            </UnsavedProvider>
          </div>
        </div>

        <p className="mt-12 border-t border-ink-600 pt-4 font-mono text-[11px] text-ink-400 md:ml-[14rem]">
          DeskDev Studio{isSupabaseConfigured ? '' : ' · local build'}
        </p>
      </div>

      <ConfirmDialog
        open={leavingFor !== null}
        title="Discard your changes?"
        message="The edits you have not saved will be lost."
        confirmLabel="Discard"
        danger
        onConfirm={() => {
          if (typeof leavingFor === 'string') go(leavingFor)
          else if (leavingFor) {
            // Discarded: follow the link that was stopped.
            unsaved.current.clear()
            if (document.contains(leavingFor)) leavingFor.click()
            else window.location.assign(leavingFor.href)
          }
        }}
        onClose={() => setLeavingFor(null)}
      />
    </Layout>
  )
}
