import { toast } from 'sonner'
import { IndicatorGroup, LayoutIndicator } from '../motion'
import { useStore, useCurrentUser } from '../../store/useStore'
import { isAdmin } from '../../lib/permissions'
import { classNames } from '../../lib/format'
import type { Client, ClientShowcaseConsent } from '../../lib/types'
import { CLIENT_CONSENT_LABELS, ConsentBadge } from './showcaseBits'

const OPTIONS: ClientShowcaseConsent[] = ['unknown', 'granted', 'declined']

/**
 * Arrow keys, Home and End move focus between the three options and nothing
 * else. Elsewhere a radio group checks as it moves; here every choice is saved
 * at once and announced, so walking past an option must not record it. Enter,
 * Space or a click records the focused one.
 */
function moveFocus(e: React.KeyboardEvent<HTMLElement>) {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])'))
  const i = radios.indexOf(document.activeElement as HTMLElement)
  if (i === -1) return
  e.preventDefault()
  const n = radios.length
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1
    : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n
  radios[next].focus()
}

/**
 * May this client's work appear on the public showcase? Recording it is an
 * admin's job (the store drops the field for anyone else and the database
 * refuses it, 037), so everyone else sees the value read-only.
 */
export default function ClientConsentControl({ client }: { client: Client }) {
  const user = useCurrentUser()
  const updateClient = useStore((s) => s.updateClient)
  const admin = isAdmin(user)
  const consent = client.showcaseConsent ?? 'unknown'

  const choose = (next: ClientShowcaseConsent) => {
    if (next === consent) return
    try {
      updateClient(client.id, { showcaseConsent: next })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Showcase consent could not be saved.')
      return
    }
    const stored = useStore.getState().clients.find((c) => c.id === client.id)?.showcaseConsent ?? 'unknown'
    if (stored !== next) {
      toast.error('Only an admin can record showcase consent.')
      return
    }
    toast.success(`Showcase consent: ${CLIENT_CONSENT_LABELS[next]}`)
  }

  return (
    <section
      aria-labelledby="client-showcase-consent"
      className="flex flex-col gap-3 border-t border-ink-600 pt-4 md:flex-row md:items-center md:justify-between md:gap-6"
    >
      <div className="min-w-0">
        <h3 id="client-showcase-consent" className="text-sm font-medium text-ink-50">Showcase consent</h3>
        <p id="client-showcase-consent-hint" className="mt-0.5 max-w-[60ch] text-xs leading-relaxed text-ink-300">
          {admin
            ? 'Sets the consent on this client’s next showcase draft. Items that already exist keep their own.'
            : 'Whether this client’s work may appear on the public showcase. An admin records it.'}
        </p>
      </div>
      {admin ? (
        <IndicatorGroup id={`client-consent-${client.id}`}>
          <div
            role="radiogroup"
            aria-labelledby="client-showcase-consent"
            aria-describedby="client-showcase-consent-hint"
            onKeyDown={moveFocus}
            className="flex shrink-0 gap-1 rounded-lg border border-ink-600 bg-ink-850/60 p-1"
          >
            {OPTIONS.map((value) => {
              const active = consent === value
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  className={classNames(
                    'pressable relative whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium leading-tight pointer-coarse:min-h-11 max-md:grow',
                    active ? 'text-ink-50' : 'text-ink-200 hover:text-ink-50',
                  )}
                  onClick={() => choose(value)}
                >
                  {active && (
                    <LayoutIndicator
                      layoutId="client-consent"
                      radius={6}
                      className={classNames(
                        'absolute inset-0 border shadow-(--shadow-1)',
                        value === 'granted'
                          ? 'border-emerald-500/40 bg-emerald-500/15'
                          : value === 'declined'
                            ? 'border-rose-500/40 bg-rose-500/15'
                            : 'border-ink-500 bg-ink-700',
                      )}
                    />
                  )}
                  <span className="relative">{CLIENT_CONSENT_LABELS[value]}</span>
                </button>
              )
            })}
          </div>
        </IndicatorGroup>
      ) : (
        <ConsentBadge consent={consent} className="self-start md:self-center" />
      )}
    </section>
  )
}
