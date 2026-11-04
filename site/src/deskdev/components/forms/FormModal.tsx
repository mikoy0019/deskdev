import { useState } from 'react'
import { toast } from 'sonner'
import { CheckCircleIcon, EnvelopeOpenIcon } from '@phosphor-icons/react'
import Modal from '../Modal'
import FormFields from './FormFields'
import { useCurrentUser, useStore } from '../../store/useStore'
import { can } from '../../lib/permissions'
import { fmtDate } from '../../lib/format'
import { formProgress, type Answers, type FormTemplate } from '../../lib/forms'

/**
 * One form (lib/forms.ts) for a project or a lead, filled in by the team —
 * at a kickoff, in a meeting, or reviewing what the customer sent back
 * through a quick-form link. Starts from the stored answers, else `prefill`.
 * Completing it checks the required answers and writes the bound ones back
 * (saveFormResponse); closing it keeps anything typed as a draft.
 */
export default function FormModal({
  template, projectId, leadId, prefill, prefillNote, completeLabel, completedToast, customerName, onClose,
}: {
  template: FormTemplate
  projectId?: string
  leadId?: string
  prefill: Answers
  /** Shown under the description when the prefill came from somewhere, e.g. the website enquiry. */
  prefillNote?: string
  completeLabel: string
  completedToast: string
  /** Who the customer is, for "Maya sent their answers". */
  customerName?: string
  onClose: () => void
}) {
  const user = useCurrentUser()
  const canEdit = can(user, projectId ? 'projects' : 'growth', 'edit')
  const saveFormResponse = useStore((s) => s.saveFormResponse)
  const response = useStore((s) =>
    s.formResponses.find((r) => r.form === template.key && (projectId ? r.projectId === projectId : r.leadId === leadId && !r.projectId)),
  )

  const [initial] = useState<Answers>(() => response?.answers ?? prefill)
  const [values, setValues] = useState<Answers>(initial)
  const [showMissing, setShowMissing] = useState(false)
  const submitted = response?.status === 'submitted'
  // Only real edits count: opening the form and closing it again saves nothing.
  const dirty = JSON.stringify(values) !== JSON.stringify(response?.answers ?? initial)
  const progress = formProgress(template, values)
  const customerReplied = Boolean(response?.customerSubmittedAt) && !submitted

  const save = (submit: boolean): boolean => {
    const result = saveFormResponse({ form: template.key, projectId, leadId, answers: values, submit })
    if (!result.ok) {
      setShowMissing(true)
      toast.error(result.error ?? 'Could not save the form')
      return false
    }
    return true
  }

  const close = () => {
    if (canEdit && dirty && !save(false)) return
    onClose()
  }

  return (
    <Modal
      open
      wide
      onClose={close}
      title={template.title}
      footer={
        canEdit ? (
          <>
            <span className="mr-auto text-xs tabular-nums text-ink-300" aria-live="polite">
              {progress.done} of {progress.required} required answered
            </span>
            {!submitted && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  if (!save(false)) return
                  toast.success('Draft saved')
                  onClose()
                }}
              >
                Save draft
              </button>
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                if (!save(true)) return
                toast.success(submitted ? 'Saved' : completedToast)
                onClose()
              }}
            >
              {submitted ? 'Save changes' : completeLabel}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-6">
        {submitted ? (
          <p className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-2 text-[13px] text-ink-100" role="status">
            <CheckCircleIcon size={15} weight="fill" className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            Completed {fmtDate(response?.submittedAt)}. Changes still update the linked records.
          </p>
        ) : customerReplied ? (
          <p className="flex items-start gap-2 rounded-lg border border-sky-500/25 bg-sky-500/[0.07] px-3 py-2 text-[13px] leading-snug text-ink-100" role="status">
            <EnvelopeOpenIcon size={15} className="mt-px shrink-0 text-sky-700 dark:text-sky-400" aria-hidden />
            <span>
              {customerName ?? 'The customer'} sent their answers {fmtDate(response?.customerSubmittedAt)}. Review them, add
              your notes, and complete the form to update the records.
            </span>
          </p>
        ) : (
          <p className="text-[13px] leading-relaxed text-ink-200">
            {template.description}
            {prefillNote && !response ? ` ${prefillNote}` : ''}
          </p>
        )}
        <FormFields
          template={template}
          values={values}
          onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
          disabled={!canEdit}
          showMissing={showMissing}
        />
      </div>
    </Modal>
  )
}
