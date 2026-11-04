import { useState } from 'react'
import { toast } from 'sonner'
import { BuildingsIcon } from '@phosphor-icons/react'
import { useStore } from '../../store/useStore'
import { classNames } from '../../lib/format'
import { focusFirstInvalid, FormField, INPUT_INVALID, Panel } from './formKit'

type Errors = { name?: string; days?: string }

const NUMBER = 'input w-full tabular-nums sm:w-32'

/** Admin-only: workspace name + auto-archive window. */
export default function WorkspaceSection() {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)

  const [name, setName] = useState(settings.workspaceName)
  const [days, setDays] = useState(String(settings.autoArchiveDays))
  const [weeklyTarget, setWeeklyTarget] = useState(String(settings.weeklyOutreachTarget ?? 50))
  const [errors, setErrors] = useState<Errors>({})

  const save = () => {
    const trimmed = name.trim()
    // Whole days only: parseInt would quietly read "1.5" as 1.
    const parsed = Number(days)
    const next: Errors = {}
    if (!trimmed) next.name = 'Workspace name is required'
    if (days.trim() === '' || !Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
      next.days = 'Enter a whole number of days from 1 to 365'
    }
    setErrors(next)
    if (next.name || next.days) {
      focusFirstInvalid()
      return
    }
    const weekly = Math.max(0, Number.parseInt(weeklyTarget, 10) || 0)
    // The monthly client target and "goes cold after" are workspace-wide and
    // live in Settings → Growth (GrowthSection), so each value has one home.
    updateSettings({
      workspaceName: trimmed,
      autoArchiveDays: parsed,
      weeklyOutreachTarget: weekly,
    })
    // Show what was stored ("07" is 7, an empty target is 0), so the form
    // reads as saved.
    const stored = useStore.getState().settings
    setName(stored.workspaceName)
    setDays(String(stored.autoArchiveDays))
    setWeeklyTarget(String(stored.weeklyOutreachTarget ?? 50))
    toast.success('Workspace settings saved')
  }

  const dirty =
    name.trim() !== settings.workspaceName ||
    days !== String(settings.autoArchiveDays) ||
    weeklyTarget !== String(settings.weeklyOutreachTarget ?? 50)

  return (
    <Panel
      title="Workspace"
      icon={BuildingsIcon}
      dirty={dirty}
      footer={
        <button type="button" className="btn-primary" onClick={save}>
          Save workspace
        </button>
      }
    >
      <div className="grid max-w-xl grid-cols-1 gap-y-5">
        <FormField label="Workspace name" hint="Shown across the app, including the sidebar." error={errors.name}>
          {(p) => (
            <input
              {...p}
              className={classNames('input w-full', INPUT_INVALID)}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (errors.name) setErrors((er) => ({ ...er, name: undefined }))
              }}
              placeholder="DeskDev Studio"
              maxLength={120}
            />
          )}
        </FormField>

        <FormField
          label="Auto-archive window (days)"
          hint={
            <>
              Done tasks archive after <span className="tabular-nums">{Number.isInteger(Number(days)) && Number(days) > 0 ? Number(days) : '—'}</span> days.
              Archived tasks stay in history for EOD reports.
            </>
          }
          error={errors.days}
        >
          {(p) => (
            <input
              {...p}
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              step={1}
              className={classNames(NUMBER, INPUT_INVALID)}
              value={days}
              onChange={(e) => {
                setDays(e.target.value)
                if (errors.days) setErrors((er) => ({ ...er, days: undefined }))
              }}
            />
          )}
        </FormField>
      </div>

      <div className="mt-6 border-t border-ink-600 pt-5">
        <h4 className="section-title mb-4">Growth targets</h4>
        <div className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-3">
          <FormField label="Weekly outreach target" hint="Accounts to contact per week.">
            {(p) => (
              <input {...p} type="number" inputMode="numeric" min={0} className={NUMBER} value={weeklyTarget} onChange={(e) => setWeeklyTarget(e.target.value)} />
            )}
          </FormField>
        </div>
        <p className="mt-4 text-[11px] text-ink-300">
          The monthly client target and when a lead goes cold are in Settings → Growth.
        </p>
      </div>
    </Panel>
  )
}
