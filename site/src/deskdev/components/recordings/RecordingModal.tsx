import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircleIcon, CircleNotchIcon, PlusIcon } from '@phosphor-icons/react'
import Modal from '../Modal'
import { Field, FieldError } from '../tasks/formBits'
import { ClientSelect, DateField } from '../pickers'
import { useStore } from '../../store/useStore'
import { parseVideoUrl, SUPPORTED_VIDEO_HINT } from '../../lib/videoEmbed'
import { fetchVideoMeta, looksLikeUrl } from '../../lib/videoOembed'
import { useResetOnChange } from '../../lib/useResetOnChange'
import type { MeetingRecording } from '../../lib/types'

export type RecordingModalState =
  | { mode: 'new'; clientId?: string; projectId?: string; folderId?: string }
  | { mode: 'edit'; recording: MeetingRecording }
  | null

/**
 * Add or edit a meeting recording (revision 8): paste the link, and the
 * title and poster are read from YouTube, Vimeo or Loom when they answer.
 * Filed under a client, then one of its projects or its own categories.
 */
export default function RecordingModal({ state, onClose }: { state: RecordingModalState; onClose: () => void }) {
  const projects = useStore((s) => s.projects)
  const folders = useStore((s) => s.recordingFolders)
  const addRecording = useStore((s) => s.addRecording)
  const updateRecording = useStore((s) => s.updateRecording)
  const addRecordingFolder = useStore((s) => s.addRecordingFolder)

  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [thumbnail, setThumbnail] = useState<string | undefined>()
  const [recordedOn, setRecordedOn] = useState<string | undefined>()
  const [clientId, setClientId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [folderId, setFolderId] = useState('')
  const [notes, setNotes] = useState('')
  const [newCategory, setNewCategory] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lookup = useRef<AbortController | null>(null)

  useResetOnChange([state], () => {
    if (!state) return
    const r = state.mode === 'edit' ? state.recording : null
    setUrl(r?.url ?? '')
    setTitle(r?.title ?? '')
    setThumbnail(r?.thumbnailUrl)
    setRecordedOn(r?.recordedOn)
    setClientId(r?.clientId ?? (state.mode === 'new' ? state.clientId ?? '' : ''))
    setProjectId(r?.projectId ?? (state.mode === 'new' ? state.projectId ?? '' : ''))
    setFolderId(r?.folderId ?? (state.mode === 'new' ? state.folderId ?? '' : ''))
    setNotes(r?.notes ?? '')
    setNewCategory(null)
    setLooking(false)
    setError(null)
  })
  useEffect(() => () => lookup.current?.abort(), [])

  const clientProjects = useMemo(
    () => projects.filter((p) => p.clientId === clientId).sort((a, b) => a.title.localeCompare(b.title)),
    [projects, clientId],
  )
  const clientFolders = useMemo(
    () => folders.filter((f) => f.clientId === clientId).sort((a, b) => a.name.localeCompare(b.name)),
    [folders, clientId],
  )
  const embed = url.trim() ? parseVideoUrl(url.trim()) : null
  const https = /^https:\/\/\S+$/i.test(url.trim())

  const readLink = (raw: string) => {
    lookup.current?.abort()
    const link = raw.trim()
    if (!parseVideoUrl(link)) return
    const controller = new AbortController()
    lookup.current = controller
    setLooking(true)
    void fetchVideoMeta(link, controller.signal).then((meta) => {
      if (controller.signal.aborted) return
      setLooking(false)
      if (meta?.thumbnail) setThumbnail(meta.thumbnail)
      if (meta?.title) setTitle((t) => (!t.trim() || looksLikeUrl(t) ? meta.title! : t))
    })
  }

  const save = () => {
    if (!state) return
    setError(null)
    try {
      let folder = folderId || undefined
      if (newCategory !== null && newCategory.trim()) {
        if (!clientId) throw new Error('Choose the client first: categories belong to a client.')
        folder = addRecordingFolder({ clientId, name: newCategory })
      }
      const fields = {
        title: title.trim() || (embed?.label ? `${embed.label} recording` : ''),
        url: url.trim(),
        thumbnailUrl: thumbnail,
        recordedOn,
        clientId: clientId || undefined,
        projectId: projectId || undefined,
        folderId: folder,
        notes: notes.trim() || undefined,
      }
      if (state.mode === 'edit') {
        updateRecording(state.recording.id, fields)
        toast.success('Recording updated')
      } else {
        addRecording(fields)
        toast.success('Recording added')
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The recording could not be saved. Try again.')
    }
  }

  return (
    <Modal
      open={state !== null}
      onClose={onClose}
      title={state?.mode === 'edit' ? 'Edit recording' : 'Add a recording'}
      onSubmit={save}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary">{state?.mode === 'edit' ? 'Save' : 'Add recording'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Recording link"
          hint={
            <div className="flex items-center gap-1.5 text-xs text-ink-300" aria-live="polite">
              {looking ? (
                <><CircleNotchIcon size={14} className="animate-spin" aria-hidden /> Reading the title…</>
              ) : embed ? (
                <span className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-400">
                  <CheckCircleIcon size={14} aria-hidden /> {embed.label} — plays in DeskDev.
                </span>
              ) : url.trim() && https ? (
                <>Kept as a link that opens in a new tab. {SUPPORTED_VIDEO_HINT} play here.</>
              ) : (
                <>Plays here: {SUPPORTED_VIDEO_HINT}. Any other https link opens.</>
              )}
            </div>
          }
        >
          <input
            className="input w-full"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              if (parseVideoUrl(e.target.value.trim())) readLink(e.target.value)
            }}
            onBlur={(e) => readLink(e.target.value)}
            placeholder="https://www.loom.com/share/…"
            autoFocus={state?.mode === 'new'}
          />
        </Field>

        {thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element -- client-only SPA; third-party poster URLs
          <img src={thumbnail} alt="" onError={() => setThumbnail(undefined)} className="w-full rounded-lg border border-ink-600 bg-ink-700 object-cover" style={{ aspectRatio: '16 / 9' }} />
        )}

        <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
          <Field label="Title">
            <input className="input w-full" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Kickoff with Northwind" />
          </Field>
          <Field label="Recorded on">
            <DateField value={recordedOn} onChange={setRecordedOn} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Client">
            <ClientSelect
              value={clientId}
              allowNone
              onChange={(id) => {
                setClientId(id)
                setProjectId('')
                setFolderId('')
              }}
            />
          </Field>
          <Field label="Project">
            <select className="input w-full" value={projectId} disabled={!clientId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project</option>
              {clientProjects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </Field>
          {newCategory === null ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="rec-category" className="text-xs font-medium text-ink-200">Category</label>
              <div className="flex gap-1.5">
                <select id="rec-category" className="input w-full min-w-0" value={folderId} disabled={!clientId} onChange={(e) => setFolderId(e.target.value)}>
                  <option value="">No category</option>
                  {clientFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <button type="button" className="btn-ghost shrink-0 px-2" disabled={!clientId} title="New category" aria-label="New category" onClick={() => setNewCategory('')}>
                  <PlusIcon size={14} aria-hidden />
                </button>
              </div>
            </div>
          ) : (
            <Field label="New category">
              <input className="input w-full" value={newCategory} autoFocus maxLength={80} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. Kickoffs" />
            </Field>
          )}
        </div>

        <Field label={<>Notes <span className="font-normal text-ink-300">(optional)</span></>}>
          <textarea className="input min-h-[80px] w-full leading-relaxed" value={notes} maxLength={10000} onChange={(e) => setNotes(e.target.value)} placeholder="What was decided, who was there, timestamps worth jumping to." />
        </Field>

        {error && <FieldError>{error}</FieldError>}
      </div>
    </Modal>
  )
}
