import { useId, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  CheckIcon, PencilSimpleIcon, PlusIcon, SlidersHorizontalIcon, TrashIcon, XIcon,
} from '@phosphor-icons/react'
import Modal from '../Modal'
import ConfirmDialog from '../ConfirmDialog'
import { ClientCategorySelect, EngagementSelect } from '../pickers'
import { FieldError } from '../settings/formKit'
import { useStore, useCurrentUser } from '../../store/useStore'
import { can, isAdmin } from '../../lib/permissions'
import { CLIENT_COLORS, ColorSwatches } from './ClientBits'
import type { Client, ClientCategory, ClientShowcaseConsent, ClientStatus, Engagement } from '../../lib/types'
import { classNames } from '../../lib/format'
import { useResetOnChange } from '../../lib/useResetOnChange'

const STATUS_OPTIONS: [ClientStatus, string][] = [
  ['active', 'Active'],
  ['paused', 'Paused'],
  ['ended', 'Ended'],
]

/**
 * clients.showcaseConsent (037): copied onto a project's showcase draft; only
 * 'granted' can publish. An admin's call (the store and 037 refuse anyone
 * else's), so only admins see the field.
 */
const CONSENT_OPTIONS: [ClientShowcaseConsent, string][] = [
  ['unknown', 'Not asked yet'],
  ['granted', 'Yes, show their work'],
  ['declined', 'No, keep it private'],
]

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-200 mb-1.5">{label}</span>
      {children}
    </label>
  )
}

// Field errors sit under the field they belong to (never a toast across the
// screen) and are announced: the shared FieldError is a role="alert".

const INVALID = 'border-rose-500! focus:ring-rose-500/20!'
/** Small icon action in a category row: 32px for a mouse, 44px under a finger. */
const ROW_ICON = 'pressable tap-target p-2 rounded-md text-ink-300 hover:text-ink-50 hover:bg-ink-600'

// ─── Category manager ────────────────────────────────────────────────────────

function CategoryManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const clientCategories = useStore((s) => s.clientCategories)
  const clients = useStore((s) => s.clients)
  const addClientCategory = useStore((s) => s.addClientCategory)
  const updateClientCategory = useStore((s) => s.updateClientCategory)
  const deleteClientCategory = useStore((s) => s.deleteClientCategory)

  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(CLIENT_COLORS[0])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState<string | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<ClientCategory | null>(null)
  const [newError, setNewError] = useState(false)
  const [editError, setEditError] = useState(false)
  const uid = useId()

  useResetOnChange([open], () => {
    if (!open) return
    setNewName('')
    setNewColor(CLIENT_COLORS[0])
    setEditingId(null)
    setDeleteTarget(null)
    setNewError(false)
    setEditError(false)
  })

  const sorted = [...clientCategories].sort((a, b) => a.sortOrder - b.sortOrder)

  const add = () => {
    const name = newName.trim()
    if (!name) {
      setNewError(true)
      document.getElementById(`${uid}-new`)?.focus()
      return
    }
    addClientCategory({ name, color: newColor })
    setNewName('')
    toast.success('Category added')
  }

  const startEdit = (cat: ClientCategory) => {
    setEditingId(cat.id)
    setEditName(cat.name)
    setEditColor(cat.color)
    setEditError(false)
  }

  const saveEdit = (id: string) => {
    const name = editName.trim()
    if (!name) {
      setEditError(true)
      return
    }
    updateClientCategory(id, { name, color: editColor })
    setEditingId(null)
    toast.success('Category updated')
  }

  const usageCount = (id: string) => clients.filter((c) => c.categoryId === id).length

  return (
    <Modal open={open} onClose={onClose} title="Manage categories">
      <div className="space-y-4">
        <div className="space-y-2">
          {/* Label above the field (as every form here), not a placeholder standing in for one. */}
          <label htmlFor={`${uid}-new`} className="block text-xs font-medium text-ink-200">New category name</label>
          <div className="flex gap-2">
            <input
              id={`${uid}-new`}
              className={classNames('input flex-1 min-w-0', newError && INVALID)}
              aria-invalid={newError || undefined}
              aria-describedby={newError ? `${uid}-new-error` : undefined}
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                if (newError) setNewError(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add()
              }}
            />
            <button className="btn-primary shrink-0 pointer-coarse:min-h-11" onClick={add}>
              <PlusIcon size={16} aria-hidden />
              Add
            </button>
          </div>
          <FieldError id={`${uid}-new-error`} error={newError ? 'Category name is required' : null} className="mt-1.5" />
          <ColorSwatches value={newColor} onChange={setNewColor} />
        </div>

        <div className="border-t border-ink-600 pt-3 space-y-1">
          {sorted.length === 0 && (
            <p className="text-sm text-ink-300 text-center py-4">No categories yet.</p>
          )}
          {sorted.map((cat) =>
            editingId === cat.id ? (
              <div key={cat.id} className="rounded-lg bg-ink-700/60 p-2.5 space-y-2">
                <input
                  className={classNames('input w-full', editError && INVALID)}
                  aria-label="Category name"
                  aria-invalid={editError || undefined}
                  aria-describedby={editError ? `${uid}-edit-error` : undefined}
                  value={editName}
                  autoFocus
                  onChange={(e) => {
                    setEditName(e.target.value)
                    if (editError) setEditError(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit(cat.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                />
                <FieldError id={`${uid}-edit-error`} error={editError ? 'Category name is required' : null} className="mt-1.5" />
                <ColorSwatches value={editColor} onChange={setEditColor} />
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    className={ROW_ICON}
                    title="Cancel"
                    aria-label="Cancel"
                    onClick={() => setEditingId(null)}
                  >
                    <XIcon size={16} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={classNames(ROW_ICON, 'hover:text-emerald-700 dark:hover:text-emerald-400')}
                    title="Save"
                    aria-label="Save"
                    onClick={() => saveEdit(cat.id)}
                  >
                    <CheckIcon size={16} aria-hidden />
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={cat.id}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-ink-700/60 transition-colors duration-150 ease-[ease]"
              >
                <span
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: cat.color ?? 'rgb(var(--ink-400))' }}
                  aria-hidden
                />
                <span className="flex-1 min-w-0 text-sm text-ink-50 truncate" title={cat.name}>{cat.name}</span>
                <span className="text-xs text-ink-300 shrink-0 tabular-nums">
                  {usageCount(cat.id)} {usageCount(cat.id) === 1 ? 'client' : 'clients'}
                </span>
                <button
                  type="button"
                  className={ROW_ICON}
                  title="Rename / recolor"
                  aria-label={`Rename / recolor: ${cat.name}`}
                  onClick={() => startEdit(cat)}
                >
                  <PencilSimpleIcon size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className={classNames(ROW_ICON, 'hover:text-rose-600 dark:hover:text-rose-400')}
                  title="Delete"
                  aria-label={`Delete: ${cat.name}`}
                  onClick={() => setDeleteTarget(cat)}
                >
                  <TrashIcon size={16} aria-hidden />
                </button>
              </div>
            ),
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete category"
        message={
          deleteTarget
            ? `Delete "${deleteTarget.name}"? ${usageCount(deleteTarget.id)} ${
                usageCount(deleteTarget.id) === 1 ? 'client uses' : 'clients use'
              } this category.`
            : ''
        }
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (!deleteTarget) return
          deleteClientCategory(deleteTarget.id)
          toast.success('Category deleted')
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </Modal>
  )
}

// ─── Client create / edit modal ──────────────────────────────────────────────

export default function ClientModal({
  open,
  onClose,
  client,
}: {
  open: boolean
  onClose: () => void
  /** Omit to create a new client */
  client?: Client
}) {
  const user = useCurrentUser()
  const addClient = useStore((s) => s.addClient)
  const updateClient = useStore((s) => s.updateClient)

  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined)
  const [engagement, setEngagement] = useState<Engagement>('full_time')
  const [status, setStatus] = useState<ClientStatus>('active')
  const [timezone, setTimezone] = useState('')
  const [color, setColor] = useState<string>(CLIENT_COLORS[0])
  const [notes, setNotes] = useState('')
  const [showcaseConsent, setShowcaseConsent] = useState<ClientShowcaseConsent>('unknown')
  const [managerOpen, setManagerOpen] = useState(false)
  const [nameError, setNameError] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const uid = useId()

  useResetOnChange([open, client], () => {
    if (!open) return
    setName(client?.name ?? '')
    setCompany(client?.company ?? '')
    setEmail(client?.email ?? '')
    setPhone(client?.phone ?? '')
    setCategoryId(client?.categoryId)
    setEngagement(client?.engagement ?? 'gig_on_call')
    setStatus(client?.status ?? 'active')
    setTimezone(client?.timezone ?? '')
    setColor(client?.color ?? CLIENT_COLORS[0])
    setNotes(client?.notes ?? '')
    setShowcaseConsent(client?.showcaseConsent ?? 'unknown')
    setManagerOpen(false)
    setNameError(false)
    setSaveError(null)
  })

  const canManageCategories = user?.role === 'admin' || can(user, 'clients', 'edit')

  const save = () => {
    if (!can(user, 'clients', 'edit')) return
    if (!name.trim()) {
      setNameError(true)
      document.getElementById(`${uid}-name`)?.focus()
      return
    }
    const payload = {
      name: name.trim(),
      company: company.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      categoryId,
      engagement,
      status,
      timezone: timezone.trim() || undefined,
      color,
      notes: notes.trim() || undefined,
      ...(isAdmin(user) ? { showcaseConsent } : {}),
    }
    try {
    if (client) {
      updateClient(client.id, payload)
      toast.success('Client updated')
    } else {
      addClient(payload)
      toast.success('Client added')
    }
    onClose()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Client could not be saved. Try again.')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={client ? 'Edit client' : 'New client'}
      wide
      onSubmit={save}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!can(user, 'clients', 'edit')}>
            {client ? 'Save changes' : 'Add client'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Field label="Name *">
              <input
                id={`${uid}-name`}
                className={classNames('input w-full', nameError && INVALID)}
                value={name}
                autoFocus
                placeholder="Client name"
                aria-invalid={nameError || undefined}
                aria-describedby={nameError ? `${uid}-name-error` : undefined}
                onChange={(e) => {
                  setName(e.target.value)
                  if (nameError) setNameError(false)
                }}
              />
            </Field>
            <FieldError id={`${uid}-name-error`} error={nameError ? 'Client name is required' : null} className="mt-1.5" />
          </div>
          <Field label="Company">
            <input
              className="input w-full"
              value={company}
              placeholder="Company"
              onChange={(e) => setCompany(e.target.value)}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="input w-full"
              value={email}
              placeholder="name@company.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </div>
        <details open={client ? true : undefined}>
          <summary className="pressable cursor-pointer rounded-md py-2 text-sm text-ink-200">More details (optional)</summary>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Phone">
            <input
              type="tel"
              inputMode="tel"
              className="input w-full"
              value={phone}
              placeholder="+1 555 000 0000"
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-ink-200">Category</span>
              {canManageCategories && (
                <button
                  type="button"
                  className="pressable inline-flex items-center gap-1 rounded-sm text-xs text-brand-700 dark:text-brand-400 hover:text-brand-600 dark:hover:text-brand-300 pointer-coarse:-my-3.5 pointer-coarse:py-3.5"
                  onClick={() => setManagerOpen(true)}
                >
                  <SlidersHorizontalIcon size={14} aria-hidden />
                  Manage categories
                </button>
              )}
            </div>
            {/* The visible caption shares its row with a button, so the select
                carries its own label. */}
            <label className="block">
              <span className="sr-only">Category</span>
              <ClientCategorySelect value={categoryId} onChange={setCategoryId} allowNone />
            </label>
          </div>
          <Field label="Engagement">
            <EngagementSelect value={engagement} onChange={setEngagement} />
          </Field>
          <Field label="Status">
            <select
              className="input w-full"
              value={status}
              onChange={(e) => setStatus(e.target.value as ClientStatus)}
            >
              {STATUS_OPTIONS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Timezone">
            <input
              className="input w-full"
              value={timezone}
              placeholder="e.g. America/New_York"
              onChange={(e) => setTimezone(e.target.value)}
            />
          </Field>
        </div>

        <div>
          <span id={`${uid}-color`} className="block text-xs font-medium text-ink-200 mb-1.5">Color</span>
          <ColorSwatches value={color} onChange={setColor} labelledBy={`${uid}-color`} />
        </div>

        {isAdmin(user) && (
          <div>
            <Field label="Portfolio consent">
              <select
                className="input w-full"
                value={showcaseConsent}
                onChange={(e) => setShowcaseConsent(e.target.value as ClientShowcaseConsent)}
              >
                {CONSENT_OPTIONS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <p className="mt-1.5 text-[11px] leading-snug text-ink-400">
              May their finished projects appear on nixgensolutions.com/portfolio? Nothing is published without a yes.
            </p>
          </div>
        )}

        <Field label="Notes">
          <textarea
            className="input w-full min-h-[80px] resize-y"
            value={notes}
            placeholder="Anything worth remembering about this client…"
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        </details>
        <FieldError error={saveError} />
      </div>

      <CategoryManager open={managerOpen} onClose={() => setManagerOpen(false)} />
    </Modal>
  )
}
