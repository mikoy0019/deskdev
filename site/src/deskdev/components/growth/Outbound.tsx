import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PlusIcon, TrashIcon } from '@phosphor-icons/react'
import ConfirmDialog from '../ConfirmDialog'
import { useStagger } from '../motion'
import { useStore } from '../../store/useStore'
import { fmtNumber, isoDate, classNames } from '../../lib/format'
import type { Campaign, CampaignChannel } from '../../lib/types'
import { Meter, RateBar, CHANNEL_LABEL, GhostCount, GhostSelect, GhostText, SECTION_LIST, useNow } from './shared'

const METRICS = ['contacted', 'opens', 'replies', 'positive'] as const

/** Weekly outreach meter + open/reply/positive rates. Read-only summary. */
export function OutboundRates({
  contacted, weeklyTarget, openRate, replyRate, positiveRate,
}: {
  contacted: number
  weeklyTarget: number
  openRate: number
  replyRate: number
  positiveRate: number
}) {
  return (
    <div>
      <div className="mb-5">
        <div className="flex items-baseline justify-between gap-3 mb-1.5">
          <span className="text-xs text-ink-200">Contacted this week</span>
          <span className="text-xs tabular-nums text-ink-50">{fmtNumber(contacted)} / {fmtNumber(weeklyTarget)}</span>
        </div>
        <Meter value={contacted} max={weeklyTarget} label="Contacted this week" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <RateBar label="Open" ratio={openRate} />
        <RateBar label="Reply" ratio={replyRate} />
        <RateBar label="Positive" ratio={positiveRate} />
      </div>
    </div>
  )
}

/** Editable list of this-week campaigns (the manual tracker). Self-contained. */
export function CampaignList({ canEdit }: { canEdit: boolean }) {
  const campaigns = useStore((s) => s.campaigns)
  const addCampaign = useStore((s) => s.addCampaign)
  const updateCampaign = useStore((s) => s.updateCampaign)
  const deleteCampaign = useStore((s) => s.deleteCampaign)
  // The delete button sits right beside the channel select — ask first.
  const [pendingDelete, setPendingDelete] = useState<Campaign | null>(null)

  const now = useNow()
  const today = isoDate(new Date(now))
  const weekAgoDay = isoDate(new Date(now - 7 * 864e5))
  // First load of the list this session only (never on Add or a revisit).
  const { ref: attachStagger, className: staggerClass } = useStagger<HTMLUListElement>('growth-campaigns')
  // Newest first, by when each was added: the order never depends on anything
  // that can be edited in the row, so a row holds still while it is renamed,
  // and a new one lands at the top, under the Add button.
  const wk = campaigns
    .filter((c) => c.weekOf >= weekAgoDay)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))

  // "Add" puts the cursor in the new row's name, selected, ready to type over.
  const focusNew = useRef<string | null>(null)
  useEffect(() => {
    const id = focusNew.current
    if (!id) return
    focusNew.current = null
    const field = document.querySelector<HTMLInputElement>(`[data-campaign-name="${CSS.escape(id)}"]`)
    if (!field) return
    field.focus({ preventScroll: true })
    field.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    field.select()
  }, [campaigns])

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="section-title">This week’s campaigns</span>
        {canEdit && (
          <button
            className="btn-secondary px-2.5! py-1! pointer-coarse:min-h-11 text-xs"
            onClick={() => { focusNew.current = addCampaign({ name: 'New campaign', channel: 'email', weekOf: today }) }}
          >
            <PlusIcon size={14} aria-hidden /> Add
          </button>
        )}
      </div>
      {wk.length === 0 ? (
        <p className="py-6 text-sm text-ink-300 text-center">No campaigns logged this week.</p>
      ) : (
        <ul ref={attachStagger} className={classNames(SECTION_LIST, '-mb-(--card-p) border-t border-ink-600', staggerClass)}>
          {wk.map((c) => (
            <li key={c.id} className="group/row px-(--card-p) py-3 space-y-2.5">
              {/* Wraps on phones: the name keeps a usable width on its own row, and
                  channel · status · delete drop to the next one. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                {canEdit ? (
                  <GhostText
                    className="-ml-2 flex-1 basis-48 font-medium"
                    data-campaign-name={c.id}
                    aria-label={`Campaign name: ${c.name || 'unnamed'}`}
                    title={c.name || undefined}
                    value={c.name}
                    onCommit={(name) => updateCampaign(c.id, { name })}
                  />
                ) : (
                  <span className="text-sm font-medium text-ink-50 flex-1 min-w-0 truncate">{c.name}</span>
                )}
                <div className="flex items-center gap-2 max-sm:-ml-2 sm:ml-auto">
                  {canEdit ? (
                    <GhostSelect
                      wrapClassName="shrink-0"
                      className="w-auto text-ink-200"
                      aria-label={`Channel: ${c.name}`}
                      value={c.channel}
                      onChange={(e) => updateCampaign(c.id, { channel: e.target.value as CampaignChannel })}
                    >
                      <option value="email">Email</option>
                      <option value="linkedin">LinkedIn</option>
                      <option value="cold_call">Cold call</option>
                    </GhostSelect>
                  ) : (
                    <span className="chip bg-ink-700 text-ink-200 border-ink-600">{CHANNEL_LABEL[c.channel]}</span>
                  )}
                  <span
                    className={classNames(
                      'badge capitalize',
                      c.status === 'active' ? 'badge-success' : c.status === 'paused' ? 'badge-warn' : 'badge-neutral',
                    )}
                  >
                    {c.status}
                  </span>
                  {canEdit && (
                    <button
                      className="pressable tap-target p-1.5 rounded-md text-ink-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-ink-700"
                      title="Delete"
                      aria-label={`Delete campaign: ${c.name}`}
                      onClick={() => setPendingDelete(c)}
                    >
                      <TrashIcon size={16} aria-hidden />
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2">
                {METRICS.map((k) => (
                  <label key={k} className="block min-w-0">
                    <span className="block section-title text-[11px] mb-0.5">{k}</span>
                    {canEdit ? (
                      <GhostCount
                        className="-ml-2 tabular-nums"
                        value={c[k]}
                        onCommit={(n) => updateCampaign(c.id, { [k]: n })}
                      />
                    ) : (
                      <span className="text-sm tabular-nums text-ink-100">{fmtNumber(c[k])}</span>
                    )}
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete campaign"
        message={`Delete ${pendingDelete?.name || 'this campaign'}? Its logged numbers are removed from this week's rates.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (!pendingDelete) return
          deleteCampaign(pendingDelete.id)
          toast.success('Campaign deleted')
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
