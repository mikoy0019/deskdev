import { useRef, useState } from 'react'
import { toast } from 'sonner'
import Modal from '../Modal'
import { Field } from '../tasks/formBits'
import { useStore } from '../../store/useStore'
import type { Course } from '../../lib/types'
import { useResetOnChange } from '../../lib/useResetOnChange'
import { useHeld } from './useHeld'

/** Create/edit a course. `state` is 'new', an existing course, or null (closed). */
export default function CourseModal({
  state,
  onClose,
}: {
  state: Course | 'new' | null
  onClose: () => void
}) {
  const addCourse = useStore((s) => s.addCourse)
  const updateCourse = useStore((s) => s.updateCourse)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  // The title ("Edit course" / "New course") holds while the dialog leaves.
  const held = useHeld(state)
  const existing = held && held !== 'new' ? held : null

  // Re-seed the fields each time the modal opens on a different target.
  useResetOnChange([state], () => {
    if (!state) return
    setTitle(state !== 'new' ? state.title : '')
    setDescription(state !== 'new' ? state.description ?? '' : '')
    setError(null)
  })

  const save = () => {
    const t = title.trim()
    if (!t) {
      setError('Give the course a title')
      titleRef.current?.focus()
      return
    }
    if (existing) {
      updateCourse(existing.id, { title: t, description: description.trim() || undefined })
      toast.success('Course updated')
    } else {
      addCourse({ title: t, description: description.trim() || undefined })
      toast.success('Course created')
    }
    onClose()
  }

  return (
    <Modal
      open={state !== null}
      onClose={onClose}
      title={existing ? 'Edit course' : 'New course'}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>{existing ? 'Save' : 'Create'}</button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Field label="Title" error={error}>
          <input
            ref={titleRef}
            className="input w-full aria-invalid:border-rose-500 aria-invalid:focus:border-rose-500 aria-invalid:focus:ring-rose-500/20"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              if (error) setError(null)
            }}
            placeholder="e.g. Web Foundations"
            enterKeyHint="done"
            aria-invalid={!!error || undefined}
            autoFocus
          />
        </Field>
        <Field label={<>Description <span className="font-normal text-ink-300">(optional)</span></>}>
          <textarea
            className="input w-full min-h-[88px] leading-relaxed"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this course covers and who it's for."
          />
        </Field>
      </form>
    </Modal>
  )
}
