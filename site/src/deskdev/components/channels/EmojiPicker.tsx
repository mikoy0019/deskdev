import { useEffect, useRef } from 'react'
import { EMOJI_PICKER } from '../../lib/channels'
import { classNames } from '../../lib/format'
import { PopoverPanel, type Placement } from '../motion'

/**
 * A compact emoji grid in a floating card. Closes on outside click or Escape.
 * Grows from its trigger (`placement` = where it sits relative to it); render
 * it inside <Presence> so it leaves the way it came.
 */
export default function EmojiPicker({
  onPick,
  onClose,
  className,
  placement = 'bottom-end',
}: {
  onPick: (emoji: string) => void
  onClose: () => void
  className?: string
  placement?: Placement
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // Deferred so the click that opened the picker doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener('mousedown', onDoc))
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <PopoverPanel
      ref={ref}
      placement={placement}
      className={classNames('card p-2 z-30 w-64 pointer-coarse:w-[min(20rem,calc(100vw-2rem))]', className)}
      style={{ boxShadow: 'var(--shadow-3)' }}
      role="dialog"
      aria-label="Pick an emoji"
    >
      <div className="grid grid-cols-8 pointer-coarse:grid-cols-6 gap-0.5">
        {EMOJI_PICKER.map((e) => (
          <button
            key={e}
            type="button"
            className="pressable h-8 w-7 pointer-coarse:h-11 pointer-coarse:w-full flex items-center justify-center rounded-md text-lg hover:bg-ink-700"
            onClick={() => onPick(e)}
            aria-label={`Emoji ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
    </PopoverPanel>
  )
}
