import { useEffect, useState } from 'react'
import { WifiHighIcon, WifiSlashIcon } from '@phosphor-icons/react'
import { useOnline } from '../../pwa/useMediaQuery'
import { isSupabaseConfigured } from '../../lib/supabase'
import { classNames } from '../../lib/format'
import { NoticePanel, Presence } from '../motion'

type Phase = 'hidden' | 'offline' | 'back'

// Remote writes are fire-and-forget (lib/db.ts): offline, each one fails and
// is reported, and the next hydrate() replaces the optimistic change — nothing
// is queued for later. Say so plainly instead of promising a sync. Local mode
// keeps everything on this device, so being offline changes nothing there.
const OFFLINE_TEXT = isSupabaseConfigured
  ? 'You’re offline — showing what’s already loaded. Changes made now won’t be saved.'
  : 'You’re offline. This workspace keeps working on this device.'

/**
 * A slim in-flow notice under the Topbar while the device is offline, and a
 * short "back online" once it reconnects. It drops in 8px from above and
 * leaves the same way (NoticePanel: 240ms in, 150ms out; a fade under reduced
 * motion). The live region stays mounted: one inserted together with its
 * text is often not announced.
 */
export default function OfflineBanner() {
  const online = useOnline()
  const [phase, setPhase] = useState<Phase>(online ? 'hidden' : 'offline')
  const [seen, setSeen] = useState(online)
  // Follow the connection during render rather than in an effect, so the
  // banner appears in the same paint as the change.
  if (online !== seen) {
    setSeen(online)
    setPhase(online ? 'back' : 'offline')
  }

  useEffect(() => {
    if (phase !== 'back') return
    const t = window.setTimeout(() => setPhase('hidden'), 2500)
    return () => window.clearTimeout(t)
  }, [phase])

  const offline = phase === 'offline'
  const Icon = offline ? WifiSlashIcon : WifiHighIcon

  return (
    <div role="status" aria-live="polite" className="shrink-0">
      <Presence initial={false}>
        {phase !== 'hidden' && (
          <NoticePanel
            key="offline"
            edge="top"
            distance="8px"
            className="flex items-center gap-2 px-4 md:px-6 py-2 border-b border-ink-600 bg-ink-800 text-xs text-ink-100"
          >
            <Icon
              size={14}
              aria-hidden
              className={classNames('shrink-0', offline ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}
            />
            <span className="min-w-0">{offline ? OFFLINE_TEXT : 'Back online.'}</span>
          </NoticePanel>
        )}
      </Presence>
    </div>
  )
}
