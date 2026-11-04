import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BellIcon, BellRingingIcon, BellSlashIcon, CircleNotchIcon, DeviceMobileIcon, DownloadSimpleIcon,
  SpeakerHighIcon, SpeakerXIcon,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { IconTile, Panel, Switch } from './formKit'
import { NOTIFY_CATEGORIES } from '../../lib/notifications'
import { useCurrentUser } from '../../store/useStore'
import { can } from '../../lib/permissions'
import { primeSpeech, speechSupported } from '../messages/announce'
import { notificationPermission, requestNotificationPermission, testNotification } from '../notifications/desktop'
import { useNotifyPrefs } from '../notifications/prefs'
import { usePushState, type PushState } from '../../pwa/push'
import { detectPlatform, isStandalone } from '../../pwa/platform'

const BUTTON = 'pointer-coarse:min-h-11'

/** How to undo a "Block" on this kind of device — the app can't ask again. */
function unblockSteps(): string {
  const p = detectPlatform()
  if (p.os === 'ios') return 'On your iPhone or iPad, open Settings → Notifications → DeskDev and turn on Allow Notifications.'
  if (p.os === 'android') {
    return isStandalone()
      ? 'Long-press the DeskDev icon → App info → Notifications, and allow them.'
      : 'In Chrome, tap ⋮ → Settings → Site settings → Notifications, and allow this site.'
  }
  return isStandalone()
    ? 'Open the app menu (⋯) → App info → Site settings, set Notifications to Allow, then reopen DeskDev.'
    : 'Click the icon left of the address bar → Notifications → Allow, then reload DeskDev.'
}

function pushCopy(state: PushState): string {
  switch (state) {
    case 'on':
      return 'On for this device. New messages, mentions and tasks reach you even when DeskDev is closed.'
    case 'off':
      return 'Get notified on this device even when DeskDev is closed — tap a notification to open the right screen.'
    case 'needs-install':
      return 'On iPhone and iPad, notifications only reach DeskDev installed on your Home Screen. Install it, open it from the icon, then turn this on there.'
    case 'denied':
      return `Notifications are blocked for DeskDev on this device. ${unblockSteps()}`
    case 'unconfigured':
      return 'Push notifications aren’t set up for this workspace yet.'
    default:
      return 'This browser can’t receive push notifications. Try Chrome, Edge, Firefox or Safari, or the installed app.'
  }
}

function PushBlock({ onPermissionChange }: { onPermissionChange: () => void }) {
  const push = usePushState()
  const me = useCurrentUser()
  const [testing, setTesting] = useState(false)
  const on = push.state === 'on'
  const hasActions = on || push.state === 'off' || push.state === 'needs-install'

  const sendTest = async () => {
    setTesting(true)
    const sent = await push.sendTest()
    setTesting(false)
    if (sent) toast.success('Test push sent — it should arrive in a few seconds')
    else toast.error('The test push didn’t go out. Turn push off and on again, or try later.')
  }

  return (
    <Panel
      title="Push notifications"
      icon={DeviceMobileIcon}
      iconTone={on ? 'brand' : 'neutral'}
      description={
        <>
          <p aria-live="polite">
            {push.busy && push.state === 'off' ? 'Checking this device…' : pushCopy(push.state)}
          </p>
          {push.state === 'unconfigured' && me?.role === 'admin' && (
            <p className="mt-1">
              Admins: the setup steps are in <code className="font-mono text-[11px] text-ink-200">supabase/PUSH.md</code>.
            </p>
          )}
        </>
      }
      bodyClassName="pb-5 pt-4 sm:pl-[4.75rem]"
    >
      {hasActions && (
        <div className="flex flex-wrap gap-2">
          {push.state === 'needs-install' && (
            <Link to="/install" className={`btn-primary ${BUTTON}`}>
              <DownloadSimpleIcon size={14} aria-hidden /> Install DeskDev
            </Link>
          )}
          {push.state === 'off' && (
            <button
              type="button"
              className={`btn-primary ${BUTTON}`}
              disabled={push.busy}
              onClick={() => {
                // Inside the tap: the permission prompt and the speech unlock both need it.
                primeSpeech()
                void push.enable().then(onPermissionChange)
              }}
            >
              {push.busy ? <CircleNotchIcon size={14} className="animate-spin" aria-hidden /> : <BellIcon size={14} aria-hidden />}
              Turn on
            </button>
          )}
          {on && (
            <>
              <button type="button" className={`btn-secondary ${BUTTON}`} disabled={testing || push.busy} onClick={() => void sendTest()}>
                {testing && <CircleNotchIcon size={14} className="animate-spin" aria-hidden />}
                Send test push
              </button>
              <button type="button" className={`btn-ghost ${BUTTON}`} disabled={push.busy} onClick={() => void push.disable()}>
                <BellSlashIcon size={14} aria-hidden /> Turn off
              </button>
            </>
          )}
        </div>
      )}
    </Panel>
  )
}

/**
 * Settings → Notifications. In-app notifications (the bell) always arrive;
 * this controls what also notifies you on this device — push for when DeskDev
 * is closed, popups while it's open — and whether it speaks.
 */
export default function NotificationsSection() {
  const [prefs, update] = useNotifyPrefs()
  const me = useCurrentUser()
  // A category tied to a feature (leads → Growth) is only ever sent to people
  // who can view that feature, so nobody else is shown a switch that does nothing.
  const categories = NOTIFY_CATEGORIES.filter((c) => !c.feature || can(me, c.feature, 'view'))
  const [permission, setPermission] = useState(notificationPermission)
  const pushNeedsInstall = detectPlatform().os === 'ios' && !isStandalone()

  const blocked = permission === 'denied'
  const unsupported = permission === 'unsupported'
  const granted = permission === 'granted'

  const enable = async () => {
    // Must happen inside the click: browsers grant only from a gesture, and
    // Chrome keeps speech muted until one.
    primeSpeech()
    const next = await requestNotificationPermission()
    setPermission(next)
    if (next === 'granted') {
      update({ desktop: true })
      toast.success('Notifications are on')
    } else if (next === 'denied') toast.error('Notifications were blocked for DeskDev')
  }

  const test = async () => {
    primeSpeech()
    const { shown, spoke, reason } = await testNotification(prefs.voice)
    if (!shown) toast.error(reason ?? 'Notification could not be shown')
    else if (prefs.voice && !spoke) toast(`Notification sent${reason ? ` — ${reason}` : ''}`)
    else toast.success('Notification sent — if nothing appeared, check Do Not Disturb or Focus')
  }

  const openOn = granted && prefs.desktop
  return (
    <div className="space-y-5">
      <PushBlock onPermissionChange={() => setPermission(notificationPermission())} />

      <Panel
        title="While DeskDev is open"
        icon={openOn ? BellRingingIcon : BellSlashIcon}
        iconTone={openOn ? 'brand' : 'neutral'}
        description={
          unsupported
            ? pushNeedsInstall
              ? 'On iPhone and iPad, notifications work in the installed app — see Push notifications above.'
              : 'This browser cannot show notifications.'
            : blocked
              ? `Blocked for DeskDev on this device. ${unblockSteps()}`
              : granted
                ? 'A notification on this device while DeskDev is open, even in the background. While you’re using the app on a phone it shows as a banner inside DeskDev instead.'
                : 'Get a notification on this device when something needs you, even when DeskDev is in the background.'
        }
        aside={
          granted ? (
            <Switch on={prefs.desktop} onChange={(v) => update({ desktop: v })} label="Notifications while DeskDev is open" />
          ) : undefined
        }
        footer={
          granted ? (
            <button className={`btn-secondary ${BUTTON}`} onClick={() => void test()} disabled={!prefs.desktop}>
              Send a test
            </button>
          ) : undefined
        }
      >
        {!granted && !blocked && !unsupported && (
          <div className="sm:pl-14">
            <button className={`btn-primary ${BUTTON}`} onClick={() => void enable()}>
              <BellIcon size={14} aria-hidden /> Turn on notifications
            </button>
          </div>
        )}
        {granted && (
          <div className="flex items-start gap-4 border-t border-ink-600 pt-4">
            <IconTile icon={prefs.voice ? SpeakerHighIcon : SpeakerXIcon} tone={prefs.voice && speechSupported() ? 'brand' : 'neutral'} />
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold text-ink-50">Spoken announcement</h4>
              <p className="mt-1 text-xs leading-relaxed text-ink-300">
                {speechSupported()
                  ? '“Boss, message from Alex” — spoken after a few quiet minutes, so an ongoing exchange stays silent. Only while DeskDev is on screen.'
                  : 'This browser has no speech synthesis.'}
              </p>
            </div>
            <Switch
              on={prefs.voice && speechSupported()}
              onChange={(v) => {
                if (v) primeSpeech()
                update({ voice: v })
              }}
              label="Spoken announcement"
            />
          </div>
        )}
      </Panel>

      <Panel
        title="What to notify about"
        description="Everything still lands in the bell; this picks what also notifies you on this device, open or closed."
        bodyClassName="pt-2 pb-2"
      >
        <ul className="divide-y divide-ink-600">
          {categories.map((c) => (
            <li key={c.key} className="flex items-center gap-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink-50">{c.label}</div>
                <div className="mt-0.5 text-xs text-ink-300">{c.hint}</div>
              </div>
              <Switch
                on={prefs.categories[c.key]}
                // Push follows on its own: usePushSync re-saves this device's categories.
                onChange={(v) => update({ categories: { ...prefs.categories, [c.key]: v } })}
                label={c.label}
              />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
