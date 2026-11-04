import { useRef, useState } from 'react'
import { toast } from 'sonner'
import Modal from '../Modal'
import { Field } from '../tasks/formBits'
import { useStore } from '../../store/useStore'
import type { CourseModule } from '../../lib/types'
import { useResetOnChange } from '../../lib/useResetOnChange'
import { useHeld } from './useHeld'

export type ModuleModalState =
  | { mode: 'new'; courseId: string }
  | { mode: 'edit'; module: CourseModule }
  | null

export default function ModuleModal({
  state,
  onClose,
}: {
  state: ModuleModalState
  onClose: () => void
}) {
  const addCourseModule = useStore((s) => s.addCourseModule)
  const updateCourseModule = useStore((s) => s.updateCourseModule)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  // The title holds while the dialog leaves.
  const held = useHeld(state)
  const existing = held?.mode === 'edit' ? held.module : null

  useResetOnChange([state], () => {
    if (!state) return
    setTitle(state.mode === 'edit' ? state.module.title : '')
    setError(null)
  })

  const save = () => {
    const t = title.trim()
    if (!t) {
      setError('Give the module a title')
      titleRef.current?.focus()
      return
    }
    if (state?.mode === 'edit') {
      updateCourseModule(state.module.id, { title: t })
      toast.success('Module updated')
    } else if (state?.mode === 'new') {
      addCourseModule({ courseId: state.courseId, title: t })
      toast.success('Module added')
    }
    onClose()
  }

  return (
    <Modal
      open={state !== null}
      onClose={onClose}
      title={existing ? 'Edit module' : 'New module'}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>{existing ? 'Save' : 'Add module'}</button>
        </>
      }
    >
      <form
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
            placeholder="e.g. Hosting, Domains & DNS"
            enterKeyHint="done"
            aria-invalid={!!error || undefined}
            autoFocus
          />
        </Field>
      </form>
    </Modal>
  )
}
