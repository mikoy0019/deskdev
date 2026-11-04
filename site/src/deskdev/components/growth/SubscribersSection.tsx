import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CopySimpleIcon, EnvelopeSimpleIcon } from '@phosphor-icons/react'
import { useCurrentUser, useStore } from '../../store/useStore'
import { can } from '../../lib/permissions'
import { fmtDate } from '../../lib/format'
import { InlineEmpty, Section } from './shared'

/** Rows shown before "Show all". */
const PREVIEW = 8

/**
 * Growth → Subscribers: the site footer's Dispatch sign-ups (039,
 * site_subscribers via /api/subscribe). They are never leads, so they live
 * apart from the pipeline. Nothing is mailed to them from here yet; editors
 * can copy the opted-in addresses into whatever sends the newsletter.
 */
export default function SubscribersSection() {
  const user = useCurrentUser()
  const canEdit = can(user, 'growth', 'edit')
  const subscribers = useStore((s) => s.siteSubscribers)
  const [showAll, setShowAll] = useState(false)

  const sorted = useMemo(() => [...subscribers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [subscribers])
  const active = useMemo(() => sorted.filter((s) => !s.unsubscribedAt), [sorted])
  const shown = showAll ? sorted : sorted.slice(0, PREVIEW)

  const copyActive = async () => {
    try {
      await navigator.clipboard.writeText(active.map((s) => s.email).join(', '))
      toast.success(`${active.length} address${active.length === 1 ? '' : 'es'} copied`)
    } catch {
      toast.error('Could not copy — your browser blocked the clipboard')
    }
  }

  return (
    <Section
      icon={EnvelopeSimpleIcon}
      title="Site subscribers"
      hint={`${active.length} opted in from the website's Dispatch box`}
      action={
        canEdit && active.length > 0 ? (
          <button type="button" className="btn-ghost px-2.5! py-1! pointer-coarse:py-2! text-xs" onClick={() => void copyActive()}>
            <CopySimpleIcon size={13} aria-hidden /> Copy addresses
          </button>
        ) : undefined
      }
    >
      {sorted.length === 0 ? (
        <InlineEmpty title="No subscribers yet" description="Sign-ups from the site footer appear here." glyph="notifications" />
      ) : (
        <>
          <ul className="divide-y divide-ink-600">
            {shown.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                <span className={s.unsubscribedAt ? 'min-w-0 flex-1 truncate text-ink-400 line-through' : 'min-w-0 flex-1 truncate text-ink-100'}>
                  {s.email}
                </span>
                {s.source && <span className="badge badge-neutral text-[10px]">{s.source}</span>}
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-400">
                  {s.unsubscribedAt ? `left ${fmtDate(s.unsubscribedAt)}` : fmtDate(s.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          {sorted.length > PREVIEW && (
            <button type="button" className="btn-ghost mt-2 w-full justify-center text-xs" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show all ${sorted.length}`}
            </button>
          )}
        </>
      )}
    </Section>
  )
}
