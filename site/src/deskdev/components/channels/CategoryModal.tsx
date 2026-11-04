import { useState } from 'react'
import Modal from '../Modal'
import { useStore } from '../../store/useStore'
import type { ChannelCategory } from '../../lib/types'
import { useResetOnChange } from '../../lib/useResetOnChange'

/** Create a category, or rename one (`category` set). */
export default function CategoryModal({
  open,
  onClose,
  category,
  clientId,
}: {
  open: boolean
  onClose: () => void
  category?: ChannelCategory
  /** The space a new category is created in (a client id, or unset for the studio). */
  clientId?: string
}) {
  const createChannelCategory = useStore((s) => s.createChannelCategory)
  const renameChannelCategory = useStore((s) => s.renameChannelCategory)
  const [name, setName] = useState('')

  useResetOnChange([open, category], () => {
    if (open) setName(category?.name ?? '')
  })

  const save = () => {
    if (!name.trim()) return
    if (category) renameChannelCategory(category.id, name)
    else createChannelCategory(name, clientId)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={category ? 'Rename category' : 'Create category'}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!name.trim()} onClick={save}>
            {category ? 'Save' : 'Create category'}
          </button>
        </>
      }
    >
      <label className="block">
        <span className="block text-xs font-medium text-ink-200">Category name</span>
        <input
          className="input mt-1.5 w-full"
          value={name}
          maxLength={60}
          placeholder="e.g. Client work"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          autoFocus
        />
      </label>
      <p className="mt-2 text-xs text-ink-300">Categories group channels in the list. Anyone can add channels to them.</p>
    </Modal>
  )
}
