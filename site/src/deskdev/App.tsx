import { Suspense, useEffect, useRef, type ReactNode } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { ArrowsClockwiseIcon, WifiSlashIcon } from '@phosphor-icons/react'
import { toast } from 'sonner'
import * as db from './lib/db'
import type { PermFeature } from './lib/types'
import { useRemoteSync } from './lib/realtime'
import { useMessageNotifications } from './components/messages/useMessageNotifications'
import { useNotificationAlerts } from './components/notifications/useNotificationAlerts'
import { useStore } from './store/useStore'
import AppErrorBoundary from './components/AppErrorBoundary'
import { DensityProvider } from './components/ui-foundation/DensityProvider'
import CommandPalette from './components/ui-foundation/CommandPalette'
import { SkeletonBlock, SkeletonLine, SkeletonList } from './components/ui-foundation'
import { lazyPage, RouteBoundary } from './components/ui-foundation/lazyPage'
import AuthGate from './components/AuthGate'
import RequirePerm from './components/RequirePerm'
import Layout from './components/Layout'
import UpdatePrompt from './components/mobile/UpdatePrompt'
import { useAppBadge } from './pwa/useAppBadge'
import { useOnline } from './pwa/useMediaQuery'
import { onServiceWorkerMessage, runBackgroundPrefetch } from './pwa/serviceWorker'
import { appPathFromUrl } from './pwa/paths'
import Login from './pages/Login'
import OperationsRuntime from './cube/OperationsRuntime'
import PresenceRuntime from './components/presence/PresenceRuntime'
import ResetPassword from './pages/ResetPassword'
import AuthCallback from './pages/AuthCallback'
import Home from './pages/Home'
import Tasks from './pages/Tasks'
import Clients from './pages/Clients'
import ClientDetail from './pages/ClientDetail'
import NotificationsPage from './pages/NotificationsPage'
import NotFound from './pages/NotFound'

// Every lazy screen's chunk is prefetched after sign-in (PrefetchScreens)
// through these same functions, so the prefetch and the route share one chunk.
const loadProjects = () => import('./pages/Projects')
const loadProjectDetail = () => import('./pages/ProjectDetail')
const loadCrmTables = () => import('./pages/CrmTables')
const loadCrmTableDetail = () => import('./pages/CrmTableDetail')
const loadCalendarPage = () => import('./pages/CalendarPage')
const loadMeetings = () => import('./pages/Meetings')
const loadRecordings = () => import('./pages/Recordings')
const loadWhiteboards = () => import('./pages/Whiteboards')
const loadAssistant = () => import('./pages/Assistant')
const loadWhiteboardBoard = () => import('./pages/WhiteboardBoard')
const loadGrowthHub = () => import('./pages/GrowthHub')
const loadGrowthLeads = () => import('./pages/GrowthLeads')
const loadGrowthOutbound = () => import('./pages/GrowthOutbound')
const loadShowcase = () => import('./pages/Showcase')
const loadCourses = () => import('./pages/Courses')
const loadCourseDetail = () => import('./pages/CourseDetail')
const loadMessages = () => import('./pages/Messages')
const loadChannels = () => import('./pages/Channels')
const loadVault = () => import('./pages/Vault')
const loadSettings = () => import('./pages/Settings')
const loadInstall = () => import('./pages/Install')
const loadCube = () => import('./pages/Cube')

// The tabs a phone opens first, then everything else: once they are fetched
// the service worker has them, so no screen is missing on an offline launch.
const MAIN_TABS = [loadProjects, loadMessages, loadChannels, loadCalendarPage]
const OTHER_SCREENS = [
  loadProjectDetail, loadCrmTables, loadCrmTableDetail, loadMeetings, loadRecordings, loadWhiteboards, loadAssistant, loadGrowthHub, loadGrowthLeads,
  loadGrowthOutbound, loadShowcase, loadCourses, loadCourseDetail, loadVault, loadSettings, loadInstall, loadCube,
]

// lazyPage: a chunk that can't be fetched is retried once, then shown as a
// "not available" screen with a retry (RouteBoundary) instead of an app error.
const Projects = lazyPage(loadProjects)
const ProjectDetail = lazyPage(loadProjectDetail)
const CrmTables = lazyPage(loadCrmTables)
const CrmTableDetail = lazyPage(loadCrmTableDetail)
const CalendarPage = lazyPage(loadCalendarPage)
const Meetings = lazyPage(loadMeetings)
const Recordings = lazyPage(loadRecordings)
const Whiteboards = lazyPage(loadWhiteboards)
const Assistant = lazyPage(loadAssistant)
const WhiteboardBoard = lazyPage(loadWhiteboardBoard)
const GrowthHub = lazyPage(loadGrowthHub)
const GrowthLeads = lazyPage(loadGrowthLeads)
const GrowthApplications = lazyPage(() => import('./pages/GrowthApplications'))
const GrowthOutbound = lazyPage(loadGrowthOutbound)
const Showcase = lazyPage(loadShowcase)
const Courses = lazyPage(loadCourses)
const CourseDetail = lazyPage(loadCourseDetail)
const Messages = lazyPage(loadMessages)
const Channels = lazyPage(loadChannels)
const Vault = lazyPage(loadVault)
const Settings = lazyPage(loadSettings)
const Install = lazyPage(loadInstall)
const Cube = lazyPage(loadCube)

/**
 * Shown while a lazy route's chunk downloads. Shaped like a page (title, filter bar,
 * content) rather than the bare "Loading…" it used to be — DESIGN.md forbids a spinner
 * in a void, and this is the first thing the user sees on every heavy route.
 * It renders the app shell too (only signed-in routes use it), so the top bar and
 * the phone tab bar stay put instead of blinking out on a first visit.
 */
function PageFallback() {
  const { pathname } = useLocation()
  return (
    <Layout title={titleFor(pathname) ?? ''}>
      <div className="space-y-4" aria-busy="true" aria-live="polite" aria-label="Loading page">
        <div className="flex items-center gap-3">
          <SkeletonBlock w={180} h={28} />
          <SkeletonBlock w={96} h={32} rounded="md" className="ml-auto" />
        </div>
        <div className="flex gap-2">
          {[72, 88, 64, 80].map((w, i) => (
            <SkeletonBlock key={i} w={w} h={28} rounded="full" />
          ))}
        </div>
        <SkeletonList count={6} />
      </div>
    </Layout>
  )
}

/** Public pages load before anyone signs in, so there's no shell to keep. */
function PublicPageFallback() {
  return (
    <div
      className="min-h-dvh flex items-center justify-center bg-ink-900 p-4"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading page"
    >
      <div className="card w-full max-w-md p-8 space-y-3">
        <SkeletonBlock w="55%" h={24} rounded="md" />
        <SkeletonLine />
        <SkeletonLine w="80%" />
      </div>
    </div>
  )
}

/**
 * A screen whose code could not be fetched: usually one that was never opened
 * on this device, visited while offline. Said where the screen would be, with
 * the retry; the shell around it keeps working.
 */
function ScreenUnavailable({ retry, bare }: { retry: () => void; bare?: boolean }) {
  const { pathname } = useLocation()
  const online = useOnline()
  const block = (
    <div className="max-w-md" role="alert">
      <div className="flex size-12 items-center justify-center rounded-xl border border-ink-600 bg-ink-800 text-ink-300 shadow-(--shadow-2) dark:bg-ink-700/60">
        <WifiSlashIcon size={22} aria-hidden />
      </div>
      <h2 className="mt-5 text-display text-xl font-semibold text-ink-50">
        {online ? 'This screen didn’t load' : 'This screen isn’t available offline yet'}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-200 text-pretty">
        {online
          ? 'Check your connection and try again.'
          : 'It hasn’t been opened on this device before, so it isn’t saved for offline use. Connect to the internet and try again.'}
      </p>
      <button type="button" className="btn-secondary mt-6" onClick={retry}>
        <ArrowsClockwiseIcon size={14} aria-hidden />
        Retry
      </button>
    </div>
  )
  if (bare) {
    return <div className="min-h-dvh flex items-center justify-center bg-ink-900 p-4">{block}</div>
  }
  return (
    <Layout title={titleFor(pathname) ?? ''}>
      <div className="mx-auto max-w-6xl">
        <div className="pt-6 md:pt-16">{block}</div>
      </div>
    </Layout>
  )
}

/** A lazy screen: its loading skeleton, and its own "could not load" state. */
function LazyRoute({ children, bare }: { children: ReactNode; bare?: boolean }) {
  return (
    <RouteBoundary fallback={(retry) => <ScreenUnavailable retry={retry} bare={bare} />}>
      <Suspense fallback={bare ? <PublicPageFallback /> : <PageFallback />}>{children}</Suspense>
    </RouteBoundary>
  )
}

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'Home'],
  [/^\/cube$/, 'Cube'],
  [/^\/login$/, 'Sign in'],
  [/^\/reset-password$/, 'Reset password'],
  [/^\/install$/, 'Install app'],
  [/^\/auth\/callback$/, 'Signing in'],
  [/^\/projects\/.+/, 'Project'],
  [/^\/projects$/, 'Projects'],
  [/^\/tasks$/, 'Tasks'],
  [/^\/clients\/.+/, 'Client'],
  [/^\/clients$/, 'Clients'],
  [/^\/crm\/.+/, 'Table'],
  [/^\/crm$/, 'CRM'],
  [/^\/calendar$/, 'Calendar'],
  [/^\/meetings$/, 'Meetings'],
  [/^\/recordings$/, 'Meeting Recordings'],
  [/^\/whiteboard$/, 'Whiteboard'],
  [/^\/assistant$/, 'Assistant'],
  [/^\/whiteboard\/[^/]+$/, 'Whiteboard'],
  [/^\/growth\/leads$/, 'CRM Leads'],
  [/^\/growth\/outbound$/, 'Outbound Command'],
  [/^\/growth$/, 'Growth Hub'],
  [/^\/showcase$/, 'Showcase'],
  [/^\/courses\/.+/, 'Course'],
  [/^\/courses$/, 'Courses'],
  [/^\/messages(\/.+)?$/, 'Messages'],
  [/^\/channels(\/.+)?$/, 'Channels'],
  [/^\/notifications$/, 'Notifications'],
  [/^\/vault$/, 'Vault'],
  [/^\/settings$/, 'Settings'],
]

function titleFor(pathname: string): string | undefined {
  return TITLES.find(([re]) => re.test(pathname))?.[1]
}

/**
 * Every route used to read "DeskDev Studio", which makes tabs and browser history
 * useless once more than one is open. Mounted once, inside the router.
 */
/**
 * Surfaces failed remote writes. Without this a rejected insert only reached
 * the console, so the optimistic row looked saved until the next hydrate()
 * silently dropped it — which is exactly how a missing column ate a topic.
 */
function WriteErrorReporter() {
  useEffect(() => {
    db.setWriteErrorHandler(({ table, op, message }) => {
      toast.error(`Could not save to ${table} (${op}). ${message}`, { duration: 8000 })
    })
    return () => db.setWriteErrorHandler(null)
  }, [])
  return null
}

function DocumentTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    const match = titleFor(pathname) ?? 'Page not found'
    document.title = `${match} · DeskDev Studio`
  }, [pathname])
  return null
}

/**
 * The palette searches every record in the store, so it only exists while
 * someone is signed in — on /login it would have listed the previous user's
 * clients to whoever pressed Ctrl+K next.
 */
function SignedInPalette() {
  const signedIn = useStore((s) => Boolean(s.currentUserId))
  return signedIn ? <CommandPalette /> : null
}

/** Its own component so unread-count changes don't re-render App. */
function AppBadge() {
  useAppBadge()
  return null
}

/** Not in lib.dom: the desktop app's queue of launches (manifest launch_handler). */
type LaunchWindow = Window & {
  launchQueue?: { setConsumer(consumer: (params: { readonly targetURL?: string }) => void): void }
}

function isNavigateMessage(data: unknown): data is { type: 'deskdev:navigate'; url: string } {
  if (typeof data !== 'object' || data === null) return false
  const { type, url } = data as { type?: unknown; url?: unknown }
  return type === 'deskdev:navigate' && typeof url === 'string'
}

/**
 * URLs handed to the running app from outside the router — a notification tap
 * (relayed by the service worker) or a link the installed desktop app captured
 * (launch_handler focus-existing → launchQueue). They are routed in place, so
 * nothing reloads and nothing leaves the app.
 */
function ExternalNavigation() {
  const navigate = useNavigate()
  // navigate changes with every route; the subscriptions shouldn't.
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])

  useEffect(() => {
    const go = (url: string) => {
      const path = appPathFromUrl(url)
      // Already there — e.g. the launch that opened this very window.
      if (!path || path === appPathFromUrl(window.location.href)) return
      navigateRef.current(path)
    }
    const stop = onServiceWorkerMessage((data) => {
      if (isNavigateMessage(data)) go(data.url)
    })
    ;(window as LaunchWindow).launchQueue?.setConsumer((params) => {
      if (params.targetURL) go(params.targetURL)
    })
    return stop
  }, [])
  return null
}

/**
 * Once someone is signed in and the browser is idle, fetch the screens'
 * chunks so the first tap on Projects, Chat or Calendar doesn't wait on the
 * network — and the service worker has every screen for an offline launch.
 */
function PrefetchScreens() {
  const signedIn = useStore((s) => Boolean(s.currentUserId))
  useEffect(() => {
    if (!signedIn) return
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return
    let cancelled = false
    const run = () => {
      if (cancelled) return
      runBackgroundPrefetch(MAIN_TABS)
      runBackgroundPrefetch(OTHER_SCREENS)
    }
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: 5000 })
      return () => {
        cancelled = true
        window.cancelIdleCallback(id)
      }
    }
    // Safari has no requestIdleCallback.
    const timer = window.setTimeout(run, 2000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [signedIn])
  return null
}

/** Authenticated + permission-gated route element. */
function gated(feature: PermFeature, page: ReactNode): ReactNode {
  return (
    <AuthGate>
      <RequirePerm feature={feature}>
        <LazyRoute>{page}</LazyRoute>
      </RequirePerm>
    </AuthGate>
  )
}

export default function App() {
  useRemoteSync()
  // Above the router on purpose: a new message or mention should reach you on any page.
  useMessageNotifications()
  useNotificationAlerts()

  return (
    <DensityProvider>
    <AppErrorBoundary>
      <DocumentTitle />
      <WriteErrorReporter />
      <OperationsRuntime />
      <PresenceRuntime />
      <AppBadge />
      <ExternalNavigation />
      <PrefetchScreens />
      {/* Global Ctrl/Cmd+K palette — mounted once, above the router. */}
      <SignedInPalette />
      <UpdatePrompt />
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Recovery links from password-reset emails arrive unauthenticated — no AuthGate. */}
        <Route path="/reset-password" element={<ResetPassword />} />
        {/* Install instructions are shared as a link before anyone signs in — no AuthGate. */}
        <Route path="/install" element={<LazyRoute bare><Install /></LazyRoute>} />
        {/* Session handoff from the NixGen site's Team login — also unauthenticated. */}
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/" element={<AuthGate><Home /></AuthGate>} />
        <Route path="/cube" element={<AuthGate><LazyRoute><Cube /></LazyRoute></AuthGate>} />
        <Route path="/projects" element={gated('projects', <Projects />)} />
        <Route path="/projects/:id" element={gated('projects', <ProjectDetail />)} />
        <Route path="/tasks" element={gated('tasks', <Tasks />)} />
        <Route path="/clients" element={gated('clients', <Clients />)} />
        <Route path="/clients/:id" element={gated('clients', <ClientDetail />)} />
        <Route path="/crm" element={gated('crm', <CrmTables />)} />
        <Route path="/crm/:tableId" element={gated('crm', <CrmTableDetail />)} />
        <Route path="/calendar" element={gated('calendar', <CalendarPage />)} />
        <Route path="/meetings" element={gated('meetings', <Meetings />)} />
        <Route path="/recordings" element={gated('meetings', <Recordings />)} />
        <Route path="/whiteboard" element={<AuthGate><LazyRoute><Whiteboards /></LazyRoute></AuthGate>} />
        <Route path="/assistant" element={<AuthGate><LazyRoute><Assistant /></LazyRoute></AuthGate>} />
        <Route path="/whiteboard/:boardId" element={<AuthGate><LazyRoute><WhiteboardBoard /></LazyRoute></AuthGate>} />
        <Route path="/growth" element={gated('growth', <GrowthHub />)} />
        <Route path="/growth/leads" element={gated('growth', <GrowthLeads />)} />
        <Route path="/growth/applications" element={gated('growth', <GrowthApplications />)} />
        <Route path="/growth/outbound" element={gated('growth', <GrowthOutbound />)} />
        <Route path="/showcase" element={gated('showcase', <Showcase />)} />
        <Route path="/courses" element={gated('courses', <Courses />)} />
        <Route path="/courses/:id" element={gated('courses', <CourseDetail />)} />
        {/* Chat is open to every profile — no permission gate. */}
        <Route path="/messages" element={<AuthGate><LazyRoute><Messages /></LazyRoute></AuthGate>} />
        <Route path="/messages/:id" element={<AuthGate><LazyRoute><Messages /></LazyRoute></AuthGate>} />
        {/* Channels are open to every profile too; private ones filter by membership. */}
        <Route path="/channels" element={<AuthGate><LazyRoute><Channels /></LazyRoute></AuthGate>} />
        <Route path="/channels/:id" element={<AuthGate><LazyRoute><Channels /></LazyRoute></AuthGate>} />
        <Route path="/notifications" element={<AuthGate><NotificationsPage /></AuthGate>} />
        <Route path="/vault" element={<AuthGate><LazyRoute><Vault /></LazyRoute></AuthGate>} />
        <Route path="/settings" element={<AuthGate><LazyRoute><Settings /></LazyRoute></AuthGate>} />
        <Route path="*" element={<AuthGate><NotFound /></AuthGate>} />
      </Routes>
    </AppErrorBoundary>
    </DensityProvider>
  )
}
