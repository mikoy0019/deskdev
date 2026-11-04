import Modal from './Modal'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  /** Rose confirm button for destructive actions */
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

/** Small confirm modal on top of Modal — calls onConfirm then onClose. */
export default function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-ink-100">{message}</p>
    </Modal>
  )
}
