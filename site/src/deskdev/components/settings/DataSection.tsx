import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowCounterClockwiseIcon, CloudIcon, DownloadSimpleIcon, HardDriveIcon } from '@phosphor-icons/react'
import ConfirmDialog from '../ConfirmDialog'
import { useStore } from '../../store/useStore'
import { isSupabaseConfigured } from '../../lib/supabase'
import { isoDate } from '../../lib/format'
import { isStandalone } from '../../pwa/platform'
import { Panel } from './formKit'

/** Admin-only: storage mode banner, demo-data reset, JSON export. */
export default function DataSection() {
  const resetSeed = useStore((s) => s.resetSeed)
  const [confirmReset, setConfirmReset] = useState(false)

  const exportJson = async () => {
    const s = useStore.getState()
    const payload = {
      exportedAt: new Date().toISOString(),
      settings: s.settings,
      users: s.users.map((u) => {
        const copy = { ...u }
        delete copy.password
        return copy
      }),
      clients: s.clients,
      clientCategories: s.clientCategories,
      projects: s.projects,
      projectCategories: s.projectCategories,
      tasks: s.tasks,
      taskActivity: s.taskActivity,
      timeEntries: s.timeEntries,
      crmTables: s.crmTables,
      crmColumns: s.crmColumns,
      crmRows: s.crmRows,
      events: s.events,
      notifications: s.notifications,
    }
    const json = JSON.stringify(payload, null, 2)
    const name = `deskdev-export-${isoDate()}.json`

    // An installed iOS app has nowhere to put a download — the link dead-ends.
    // Hand the file to the share sheet (Save to Files, AirDrop, Mail…) instead.
    // Nothing is awaited before share(), so the click still counts as a gesture.
    if (isStandalone() && typeof navigator.canShare === 'function') {
      const file = new File([json], name, { type: 'application/json' })
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'DeskDev export' })
          toast.success('Export shared')
          return
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return
          // Any other failure: fall back to the plain download below.
        }
      }
    }

    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Export downloaded')
  }

  return (
    <div className="space-y-5">
      {isSupabaseConfigured ? (
        <Panel
          title="Connected to Supabase"
          icon={CloudIcon}
          iconTone="success"
          description="Changes sync to your Supabase project. Local state is kept as an optimistic cache."
        />
      ) : (
        <Panel
          title="Local mode"
          icon={HardDriveIcon}
          iconTone="warn"
          description={
            <>
              All data lives in this browser’s localStorage. Set{' '}
              <code className="font-mono text-[11px] text-ink-200">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
              <code className="font-mono text-[11px] text-ink-200">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to sync to the cloud.
            </>
          }
        />
      )}

      <Panel
        title="Export data"
        description="Download every workspace entity as a single JSON file. Passwords are excluded."
        footer={
          <button type="button" className="btn-secondary pointer-coarse:min-h-11" onClick={exportJson}>
            <DownloadSimpleIcon size={14} aria-hidden />
            Export JSON
          </button>
        }
      />

      {/* Demo data has non-UUID ids: on Supabase the reset would only break
          every write until the next pull, so the control exists in local mode only. */}
      {!isSupabaseConfigured && (
        <Panel
          tone="danger"
          title="Reset demo data"
          description="Restore the original seed workspace. Every client, project, task, CRM table, event, and user you’ve added will be replaced."
          footer={
            <button
              type="button"
              className="btn border border-rose-500/30 bg-rose-500/10 text-rose-700 hover:border-rose-500/50 hover:bg-rose-500/15 dark:text-rose-400 pointer-coarse:min-h-11"
              onClick={() => setConfirmReset(true)}
            >
              <ArrowCounterClockwiseIcon size={14} aria-hidden />
              Reset demo data
            </button>
          }
        />
      )}

      <ConfirmDialog
        open={confirmReset}
        title="Reset demo data"
        message="This replaces everything in the workspace with the original seed data — including users. If your account isn't part of the seed data you'll be signed out. This can't be undone."
        confirmLabel="Reset everything"
        danger
        onConfirm={() => {
          resetSeed()
          toast.success('Demo data restored')
        }}
        onClose={() => setConfirmReset(false)}
      />
    </div>
  )
}
