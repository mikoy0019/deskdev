import { useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { CameraIcon, CircleNotchIcon, TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { Menu, MenuItem } from './channels/Menu'
import { removeAvatarObject, uploadAvatar, type AvatarOwner } from '../lib/avatarImages'
import { useStore } from '../store/useStore'

/**
 * An avatar with a camera button that changes the picture behind it (052):
 * upload or replace, and remove. Admins only — render the bare avatar for
 * everyone else. The picture is cropped to a square in the browser; the old
 * object is deleted once the new key is saved.
 */
export default function PictureMenu({
  owner,
  currentKey,
  subject,
  children,
}: {
  owner: AvatarOwner
  currentKey?: string
  /** Whose picture, for labels: "your" or the client's name. */
  subject: string
  children: ReactNode
}) {
  const setPicture = useStore((s) => s.setPicture)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const onFile = async (file: File | undefined) => {
    if (!file || busy) return
    setBusy(true)
    const up = await uploadAvatar(owner, file)
    if (!up.ok) {
      setBusy(false)
      toast.error(up.error)
      return
    }
    const saved = setPicture(owner, up.key)
    setBusy(false)
    if (!saved.ok) {
      toast.error(saved.error ?? 'Could not save the picture.')
      void removeAvatarObject(up.key)
      return
    }
    void removeAvatarObject(currentKey)
    toast.success(currentKey ? 'Picture replaced' : 'Picture added')
  }

  const remove = () => {
    const saved = setPicture(owner, null)
    if (!saved.ok) {
      toast.error(saved.error ?? 'Could not remove the picture.')
      return
    }
    void removeAvatarObject(currentKey)
    toast.success('Picture removed')
  }

  return (
    <div className="relative shrink-0 self-start">
      {children}
      {busy && (
        <div className="absolute inset-0 grid place-items-center rounded-full bg-ink-900/60" role="status" aria-label="Uploading picture">
          <CircleNotchIcon size={18} className="animate-spin text-ink-50" aria-hidden />
        </div>
      )}
      <div className="absolute -bottom-1 -right-1">
        <Menu
          label={`Change ${subject} picture`}
          align="left"
          width="w-52"
          triggerClassName="pressable grid size-7 place-items-center rounded-full bg-ink-800 text-ink-100 ring-2 ring-ink-900 shadow-[var(--shadow-1)] hover:bg-ink-700 hover:text-ink-50 pointer-coarse:size-9"
          trigger={<CameraIcon size={14} weight="bold" aria-hidden />}
        >
          {(close) => (
            <>
              <MenuItem
                icon={UploadSimpleIcon}
                onClick={() => {
                  close()
                  input.current?.click()
                }}
              >
                {currentKey ? 'Replace picture' : 'Upload picture'}
              </MenuItem>
              {currentKey && (
                <MenuItem
                  icon={TrashIcon}
                  danger
                  onClick={() => {
                    close()
                    remove()
                  }}
                >
                  Remove picture
                </MenuItem>
              )}
            </>
          )}
        </Menu>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          void onFile(file)
        }}
      />
    </div>
  )
}
