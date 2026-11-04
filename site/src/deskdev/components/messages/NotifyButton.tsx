import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BellIcon, BellRingingIcon, BellSlashIcon, SlidersHorizontalIcon } from '@phosphor-icons/react'
import { notificationPermission, requestNotificationPermission } from '../notifications/desktop'
import { useNotifyPrefs } from '../notifications/prefs'
import { primeSpeech } from './announce'

/**
 * Desktop-notification control for the inbox: the browser permission (asked
 * once, only from a click), the master switch, and a link to the full
 * preferences. Hidden entirely where the browser has no Notifications API.
 */
export default function NotifyButton() {
  const [permission, setPermission] = useState(notificationPermission)
  const [prefs, update] = useNotifyPrefs()

  if (permission === 'unsupported') return null

  if (permission === 'denied') {
    return (
      <span className="text-[11px] text-ink-400 flex items-center gap-1" title="Notifications are blocked for this site in your browser settings">
        <BellSlashIcon size={13} aria-hidden /> Notifications blocked
      </span>
    )
  }

  if (permission === 'default') {
    return (
      <button
        className="btn-ghost text-[11px] flex items-center gap-1 pointer-coarse:min-h-11"
        onClick={async () => {
          // Must happen inside the click: speech stays muted until a gesture.
          primeSpeech()
          const next = await requestNotificationPermission()
          setPermission(next)
          if (next === 'granted') update({ desktop: true })
        }}
      >
        <BellIcon size={13} aria-hidden /> Notify me
      </button>
    )
  }

  const on = prefs.desktop
  return (
    <span className="flex items-center gap-1">
      <button
        className="btn-ghost text-[11px] flex items-center gap-1 pointer-coarse:min-h-11"
        aria-pressed={on}
        title={on ? 'Notifications on — click to mute' : 'Notifications muted — click to unmute'}
        onClick={() => {
          if (!on) primeSpeech()
          update({ desktop: !on })
        }}
      >
        {on ? <BellRingingIcon size={13} aria-hidden /> : <BellSlashIcon size={13} aria-hidden />}
        {on ? 'Notifications on' : 'Muted'}
      </button>
      <Link to="/settings?section=notifications" className="btn-ghost text-[11px] text-ink-300 pointer-coarse:min-h-11" title="Notification settings">
        <SlidersHorizontalIcon size={13} aria-hidden /> Settings
      </Link>
    </span>
  )
}
