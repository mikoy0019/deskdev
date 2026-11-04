import { useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { CheckCircleIcon, CheckIcon, KeyIcon } from '@phosphor-icons/react'
import { useStore, useCurrentUser } from '../../store/useStore'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { withBase } from '../../lib/basePath'
import { classNames } from '../../lib/format'
import { RoleChip } from '../Chips'
import UserAvatar, { AVATAR_COLORS } from './UserAvatar'
import PictureMenu from '../PictureMenu'
import { SWATCH_DOT, SWATCH_DOT_ON, SWATCH_TARGET } from '../calendar/calendarShared'
import { FieldError, focusFirstInvalid, FormField, INPUT_INVALID, LABEL, Notice, Panel, radioKeys } from './formKit'

type ProfileErrors = { fullName?: string }

/** Enter in a text field saves the panel, as it does in every dialog. */
const enterSaves = (save: () => void) => (e: KeyboardEvent<HTMLElement>) => {
  if (e.key !== 'Enter' || e.defaultPrevented || e.nativeEvent.isComposing) return
  if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
  if (!(e.target instanceof HTMLInputElement) || e.target.type === 'checkbox' || e.target.type === 'radio') return
  e.preventDefault()
  save()
}
type PasswordErrors = { current?: string; next?: string }

/** Edit your own profile; change your password (local mode) or ask for a reset link (connected). */
export default function ProfileSection() {
  const user = useCurrentUser()
  const updateUser = useStore((s) => s.updateUser)
  const saveOwnProfile = useStore((s) => s.saveOwnProfile)

  const [fullName, setFullName] = useState(user?.fullName ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [title, setTitle] = useState(user?.title ?? '')
  const [color, setColor] = useState(user?.avatarColor ?? '')
  const [saving, setSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const savingRef = useRef(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [errors, setErrors] = useState<ProfileErrors>({})
  const [pwErrors, setPwErrors] = useState<PasswordErrors>({})
  const [reset, setReset] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [resetError, setResetError] = useState<string | null>(null)

  if (!user) return null

  // Edits the save buttons have not stored yet (Settings asks before leaving them).
  const profileDirty =
    fullName.trim() !== user.fullName ||
    phone.trim() !== (user.phone ?? '') ||
    title.trim() !== (user.title ?? '') ||
    color !== (user.avatarColor ?? '')
  const passwordDirty = !isSupabaseConfigured && (currentPw !== '' || newPw !== '')

  const saveProfile = async () => {
    if (savingRef.current) return
    if (!fullName.trim()) {
      setErrors({ fullName: 'Full name is required' })
      focusFirstInvalid()
      return
    }
    setErrors({})
    setProfileError(null)
    savingRef.current = true
    setSaving(true)
    try {
    const result = await saveOwnProfile({
      fullName: fullName.trim(),
      phone: phone.trim() || undefined,
      title: title.trim() || undefined,
      avatarColor: color || undefined,
    })
    if (result.ok) toast.success('Profile updated')
    else setProfileError(result.error ?? 'Your profile could not be saved. Try again.')
    } catch {
      setProfileError('Your profile could not be saved. Try again.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const changePassword = () => {
    if ((user.password ?? '') !== currentPw) {
      setPwErrors({ current: 'Current password is incorrect' })
      return
    }
    if (newPw.length < 4) {
      setPwErrors({ next: 'New password must be at least 4 characters' })
      return
    }
    setPwErrors({})
    updateUser(user.id, { password: newPw })
    setCurrentPw('')
    setNewPw('')
    toast.success('Password changed')
  }

  // Connected: the password lives with the sign-in service, so changing it
  // goes through the same emailed link as "Forgot password" on the login screen.
  const sendReset = async () => {
    if (!user.email || reset === 'sending') return
    setResetError(null)
    setReset('sending')
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}${withBase('/reset-password')}`,
      })
      if (!error) {
        setReset('sent')
        return
      }
      setResetError(
        error.status === 429
          ? 'A link was sent a moment ago. Wait a minute, then ask again.'
          : error.status === undefined || error.status === 0
            ? 'The link could not be sent. Check your connection and try again.'
            : error.message,
      )
    } catch {
      setResetError('The link could not be sent. Check your connection and try again.')
    }
    setReset('idle')
  }

  const shownName = fullName.trim() || user.fullName
  // A colour picked before the palette changed: keep one radio reachable by Tab.
  const known = color === '' || AVATAR_COLORS.includes(color)

  return (
    <div className="space-y-5">
      <Panel
        title={
          <span className="flex min-w-0 items-center gap-4">
            {user.role === 'admin' ? (
              <PictureMenu owner={{ kind: 'profiles', id: user.id }} currentKey={user.avatarKey} subject="your">
                <UserAvatar user={{ fullName: shownName, avatarColor: color || undefined, avatarKey: user.avatarKey }} size="lg" />
              </PictureMenu>
            ) : (
              <UserAvatar user={{ fullName: shownName, avatarColor: color || undefined, avatarKey: user.avatarKey }} size="lg" />
            )}
            <span className="min-w-0">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-base font-semibold text-ink-50" title={shownName}>{shownName}</span>
                <RoleChip role={user.role} />
              </span>
              <span className="block truncate text-xs font-normal text-ink-300" title={user.email}>{user.email ?? '—'}</span>
            </span>
          </span>
        }
        dirty={profileDirty}
        footer={
          <button type="button" className="btn-primary" onClick={() => void saveProfile()} disabled={saving || !profileDirty}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        }
      >
        <fieldset disabled={saving}>
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2" onKeyDown={(e) => enterSaves(saveProfile)(e)}>
          <FormField label="Full name" error={errors.fullName}>
            {(p) => (
              <input
                {...p}
                className={classNames('input w-full', INPUT_INVALID)}
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value)
                  if (errors.fullName) setErrors({})
                }}
                placeholder="Your name"
                autoComplete="name"
              />
            )}
          </FormField>
          <FormField label="Email" hint={<>Email can&apos;t be changed here.</>}>
            {(p) => (
              // Read-only, not disabled: it stays legible (disabled halves its
              // contrast) and selectable for copying.
              <input {...p} className="input w-full bg-ink-900/40 text-ink-200 dark:bg-ink-900/60" value={user.email ?? ''} readOnly />
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
                autoComplete="tel"
              />
            )}
          </FormField>
          <FormField label="Title">
            {(p) => (
              <input
                {...p}
                className="input w-full"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Product Designer"
                autoComplete="organization-title"
              />
            )}
          </FormField>
        </div>

        <div className="mt-6 border-t border-ink-600 pt-5">
          <p id="avatar-color-label" className={classNames(LABEL, 'mb-3')}>Avatar color</p>
          <div className="-mx-1 flex flex-wrap items-center gap-0.5" role="radiogroup" aria-labelledby="avatar-color-label" onKeyDown={radioKeys}>
            {AVATAR_COLORS.map((c) => {
              const on = color === c
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on || (!known && c === AVATAR_COLORS[0]) ? 0 : -1}
                  aria-label={`Avatar color ${c.replace('bg-', '').replace('-500', '')}`}
                  className={SWATCH_TARGET}
                  onClick={() => setColor(c)}
                >
                  {/* The dot every colour picker draws; the ring takes the swatch's own hue. */}
                  <span
                    aria-hidden
                    className={classNames(SWATCH_DOT, c, on && SWATCH_DOT_ON)}
                    style={{ ['--sw' as string]: `var(${c.replace('bg-', '--color-')})` }}
                  >
                    {on && <CheckIcon size={14} aria-hidden />}
                  </span>
                </button>
              )
            })}
            <button
              type="button"
              role="radio"
              aria-checked={color === ''}
              tabIndex={color === '' ? 0 : -1}
              className={classNames(
                'chip pressable ml-2 h-8 px-3 pointer-coarse:min-h-11',
                color === ''
                  ? 'border-brand-500/30 bg-brand-500/15 text-brand-700 dark:text-brand-400'
                  : 'border-ink-500 bg-ink-700 text-ink-100 hover:border-ink-400',
              )}
              onClick={() => setColor('')}
            >
              Auto
            </button>
          </div>
        </div>
        </fieldset>
        <FieldError error={profileError} className="mt-3" />
      </Panel>

      <Panel
        title="Password"
        icon={KeyIcon}
        dirty={passwordDirty}
        footer={
          isSupabaseConfigured ? (
            <button type="button" className="btn-primary" onClick={() => void sendReset()} disabled={!user.email || reset === 'sending'}>
              {reset === 'sending' ? 'Sending…' : reset === 'sent' ? 'Send it again' : 'Email me a reset link'}
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={changePassword}>
              Change password
            </button>
          )
        }
      >
        {isSupabaseConfigured ? (
          <div className="space-y-3">
            <p className="max-w-[65ch] text-sm text-ink-200 text-pretty">
              To change your password, we email a link to{' '}
              <span className="font-medium text-ink-50 [overflow-wrap:anywhere]">{user.email ?? 'your address'}</span>. Open it to
              choose a new one.
            </p>
            {reset === 'sent' && (
              <Notice tone="success" icon={CheckCircleIcon} live>
                Check your inbox. A reset link is on its way.
              </Notice>
            )}
            <FieldError error={resetError} />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2" onKeyDown={enterSaves(changePassword)}>
            <FormField label="Current password" error={pwErrors.current}>
              {(p) => (
                <input
                  {...p}
                  type="password"
                  className={classNames('input w-full', INPUT_INVALID)}
                  value={currentPw}
                  onChange={(e) => {
                    setCurrentPw(e.target.value)
                    if (pwErrors.current) setPwErrors({})
                  }}
                  autoComplete="current-password"
                />
              )}
            </FormField>
            <FormField label="New password" error={pwErrors.next}>
              {(p) => (
                <input
                  {...p}
                  type="password"
                  className={classNames('input w-full', INPUT_INVALID)}
                  value={newPw}
                  onChange={(e) => {
                    setNewPw(e.target.value)
                    if (pwErrors.next) setPwErrors({})
                  }}
                  autoComplete="new-password"
                />
              )}
            </FormField>
          </div>
        )}
      </Panel>
    </div>
  )
}
