import { useState } from 'react'
import { toast } from 'sonner'
import { CircleNotchIcon, ShieldCheckIcon, WarningCircleIcon } from '@phosphor-icons/react'
import Modal from '../Modal'
import { useStore } from '../../store/useStore'
import { ALL_FEATURES, DEFAULT_MEMBER_PERMISSIONS } from '../../lib/permissions'
import { isSupabaseConfigured } from '../../lib/supabase'
import { classNames } from '../../lib/format'
import type { PermFeature, PermLevel, Role, User } from '../../lib/types'
import { useResetOnChange } from '../../lib/useResetOnChange'
import { IndicatorGroup, LayoutIndicator } from '../motion'
import { focusFirstInvalid, FormField, INPUT_INVALID, LABEL, Notice, radioKeys, useHeldWhile } from './formKit'

type Errors = { fullName?: string; email?: string; password?: string; form?: string }

export const FEATURE_META: { key: PermFeature; label: string; letter: string }[] = [
  { key: 'projects', label: 'Projects', letter: 'P' },
  { key: 'tasks', label: 'Tasks', letter: 'T' },
  { key: 'clients', label: 'Clients', letter: 'C' },
  { key: 'crm', label: 'CRM', letter: 'R' },
  { key: 'calendar', label: 'Calendar', letter: 'L' },
  { key: 'meetings', label: 'Meetings', letter: 'M' },
  { key: 'growth', label: 'Growth Hub', letter: 'G' },
  { key: 'courses', label: 'Courses', letter: 'U' },
]

const LEVELS: { id: PermLevel; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'view', label: 'View' },
  { id: 'edit', label: 'Edit' },
]

/** Invite (user = null) or edit a workspace user, incl. the permission matrix. */
export default function UserModal({
  open,
  onClose,
  user,
}: {
  open: boolean
  onClose: () => void
  user: User | null
}) {
  const users = useStore((s) => s.users)
  const adminCreateUser = useStore((s) => s.adminCreateUser)
  const adminUpdateUser = useStore((s) => s.adminUpdateUser)

  const [busy, setBusy] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [title, setTitle] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [perms, setPerms] = useState<Record<PermFeature, PermLevel>>({
    ...DEFAULT_MEMBER_PERMISSIONS,
  })
  const [errors, setErrors] = useState<Errors>({})
  const clear = (k: keyof Errors) => setErrors((e) => (e[k] || e.form ? { ...e, [k]: undefined, form: undefined } : e))

  useResetOnChange([open, user], () => {
    if (!open) return
    setBusy(false)
    setErrors({})
    setFullName(user?.fullName ?? '')
    setEmail(user?.email ?? '')
    setPassword('')
    setPhone(user?.phone ?? '')
    setTitle(user?.title ?? '')
    setRole(user?.role ?? 'member')
    setPerms({ ...DEFAULT_MEMBER_PERMISSIONS, ...(user?.permissions ?? {}) })
  })

  // Closing an edit clears `user` in the parent; the title and labels keep
  // saying "Edit …" through the exit instead of flipping to "Invite user".
  const shown = useHeldWhile(user, open)
  const emailLocked = !!shown && isSupabaseConfigured

  const setPerm = (feature: PermFeature, level: PermLevel) =>
    setPerms((p) => ({ ...p, [feature]: level }))

  const setAll = (level: PermLevel) =>
    setPerms(
      Object.fromEntries(ALL_FEATURES.map((f) => [f, level])) as Record<PermFeature, PermLevel>,
    )

  // Supabase Auth enforces a 6-char minimum; local mode keeps its 4-char rule.
  const minPassword = isSupabaseConfigured ? 6 : 4

  const submit = async () => {
    const name = fullName.trim()
    const mail = email.trim().toLowerCase()
    // Every problem at once, each under its own field.
    const next: Errors = {}
    if (!name) next.fullName = 'Full name is required'
    if (!mail || !/^\S+@\S+\.\S+$/.test(mail)) next.email = 'Enter a valid email'
    else if (users.some((u) => u.id !== user?.id && (u.email ?? '').toLowerCase() === mail)) {
      next.email = 'A user with this email already exists'
    }
    if (!user && password.length < minPassword) next.password = `Password must be at least ${minPassword} characters`
    if (user && isSupabaseConfigured && password && password.length < minPassword) {
      next.password = `New password must be at least ${minPassword} characters`
    }
    setErrors(next)
    if (next.fullName || next.email || next.password) {
      focusFirstInvalid()
      return
    }

    const permissions = role === 'member' ? { ...perms } : {}
    const shared = {
      fullName: name,
      phone: phone.trim() || undefined,
      title: title.trim() || undefined,
      role,
      permissions,
    }

    setBusy(true)
    try {
      if (user) {
        const patch: Partial<User> = { ...shared }
        if (!emailLocked) patch.email = mail
        if (password) patch.password = password
        const res = await adminUpdateUser(user.id, patch)
        if (!res.ok) {
          setErrors({ form: res.error ?? 'Could not update user' })
          return
        }
        toast.success('User updated')
      } else {
        const res = await adminCreateUser({ ...shared, email: mail, password })
        if (!res.ok) {
          setErrors({ form: res.error ?? 'Could not create user' })
          return
        }
        toast.success(`${name} added to the workspace`)
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={shown ? `Edit ${shown.fullName}` : 'Invite user'}
      wide
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <CircleNotchIcon size={14} className="animate-spin" aria-hidden />}
            {shown ? 'Save changes' : 'Invite user'}
          </button>
        </>
      }
    >
      <div className="space-y-6">
        {errors.form && (
          <Notice tone="danger" icon={WarningCircleIcon} live>
            {errors.form}
          </Notice>
        )}
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          <FormField label="Full name *" error={errors.fullName}>
            {(p) => (
              <input
                {...p}
                className={classNames('input w-full', INPUT_INVALID)}
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value)
                  clear('fullName')
                }}
                placeholder="Jane Doe"
                autoComplete="off"
                autoFocus
              />
            )}
          </FormField>
          <FormField
            label="Email *"
            hint={emailLocked ? 'Email is managed by Supabase Auth.' : undefined}
            error={errors.email}
          >
            {(p) => (
              <input
                {...p}
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={classNames('input w-full', INPUT_INVALID, emailLocked && 'opacity-60')}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  clear('email')
                }}
                placeholder="jane@studio.com"
                disabled={emailLocked}
              />
            )}
          </FormField>
          <FormField
            label={shown ? 'New password' : 'Password *'}
            hint={
              !shown
                ? isSupabaseConfigured
                  ? 'They can sign in right away with this email and password.'
                  : 'Local mode — share this password manually. Real email invites arrive with the Supabase hookup.'
                : undefined
            }
            error={errors.password}
          >
            {(p) => (
              <input
                {...p}
                type="password"
                className={classNames('input w-full', INPUT_INVALID)}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  clear('password')
                }}
                placeholder={
                  shown ? 'Leave blank to keep current' : `At least ${minPassword} characters`
                }
                autoComplete="new-password"
              />
            )}
          </FormField>
          <FormField label="Phone">
            {(p) => (
              <input
                {...p}
                type="tel"
                className="input w-full tabular-nums"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 000 0000"
              />
            )}
          </FormField>
          <FormField label="Title" className="sm:col-span-2">
            {(p) => (
              <input
                {...p}
                className="input w-full"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Developer"
              />
            )}
          </FormField>
        </div>

        <div className="border-t border-ink-600 pt-5">
          <span id="user-role-label" className={classNames(LABEL, 'mb-2.5')}>Role</span>
          <IndicatorGroup id="user-role">
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-labelledby="user-role-label" onKeyDown={radioKeys}>
              {(
                [
                  { id: 'admin', label: 'Admin', hint: 'Full access to everything' },
                  { id: 'member', label: 'Member', hint: 'Access set per feature below' },
                ] as const
              ).map((r) => {
                const on = role === r.id
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={on ? 0 : -1}
                    className={classNames(
                      'pressable-card relative rounded-lg border p-3 text-left',
                      on ? 'border-transparent' : 'border-ink-600 hover:border-ink-500',
                    )}
                    onClick={() => setRole(r.id)}
                  >
                    {on && (
                      <LayoutIndicator
                        layoutId="user-role"
                        radius={8}
                        className="absolute -inset-px rounded-lg border-2 border-brand-500 bg-brand-500/8"
                      />
                    )}
                    <div className={classNames('relative text-sm font-semibold', on ? 'text-brand-700 dark:text-brand-400' : 'text-ink-50')}>
                      {r.label}
                    </div>
                    <div className="relative mt-0.5 text-xs text-ink-300">{r.hint}</div>
                  </button>
                )
              })}
            </div>
          </IndicatorGroup>
        </div>

        {role === 'admin' ? (
          <Notice tone="success" icon={ShieldCheckIcon}>
            Admins have full edit access to every feature — no permission
            matrix needed.
          </Notice>
        ) : (
          <div>
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <span className={LABEL}>Permissions</span>
              <div className="-mr-2 flex gap-1">
                <button type="button" className="btn-ghost px-2 py-1 text-xs pointer-coarse:min-h-11" onClick={() => setAll('view')}>
                  View all
                </button>
                <button type="button" className="btn-ghost px-2 py-1 text-xs pointer-coarse:min-h-11" onClick={() => setAll('edit')}>
                  Edit all
                </button>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-ink-600">
              <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.5rem)] items-center border-b border-ink-600 bg-ink-900/50 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_repeat(3,4.5rem)]">
                <span className="section-title text-[11px]">Feature</span>
                {LEVELS.map((l) => (
                  <span key={l.id} className="section-title text-center text-[11px]">
                    {l.label}
                  </span>
                ))}
              </div>
              {FEATURE_META.map((f) => (
                <div
                  key={f.key}
                  role="radiogroup"
                  aria-label={f.label}
                  className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.5rem)] items-center border-b border-ink-600 px-3 py-1 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_repeat(3,4.5rem)]"
                >
                  <span className="text-sm text-ink-100">{f.label}</span>
                  <IndicatorGroup id={`perm-${f.key}`}>
                    {LEVELS.map((l) => {
                      const on = perms[f.key] === l.id
                      return (
                        <label
                          key={l.id}
                          className="pressable relative flex h-9 cursor-pointer items-center justify-center rounded-md pointer-coarse:h-11"
                          title={`${f.label}: ${l.label}`}
                        >
                          {/* The level marker slides along the row to the picked cell. */}
                          {on && (
                            <LayoutIndicator
                              layoutId={`perm-${f.key}`}
                              radius={6}
                              className="absolute inset-x-1 inset-y-1 bg-brand-500/10 dark:bg-brand-500/15"
                            />
                          )}
                          <input
                            type="radio"
                            name={`perm-${f.key}`}
                            className="peer sr-only"
                            checked={on}
                            onChange={() => setPerm(f.key, l.id)}
                            aria-label={l.label}
                          />
                          <span
                            aria-hidden
                            className={classNames(
                              'relative flex size-4 items-center justify-center rounded-full border transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-ink-800',
                              on ? 'border-brand-600 bg-brand-600' : 'border-ink-400 bg-ink-800',
                            )}
                          >
                            {on && <span className="size-1.5 rounded-full bg-white" />}
                          </span>
                        </label>
                      )
                    })}
                  </IndicatorGroup>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
