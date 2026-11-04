import { useState } from 'react'
import { Alert, Text, View } from 'react-native'

import FormFields from '@/components/FormFields'
import { FormModal } from '@/components/forms'
import { Button } from '@/components/ui'
import { formProgress, type Answers, type FormTemplate } from '@/lib/forms'
import { fmtDate } from '@/lib/format'
import { can } from '@/lib/permissions'
import { fonts, useTheme } from '@/lib/theme'
import { useCurrentUser, useStore } from '@/store/useStore'

/**
 * One form (onboarding on a project, discovery on a lead) filled in by the
 * team — or reviewed after the customer sent it back through a quick-form
 * link. Starts from the stored answers, else `prefill`. Complete checks the
 * required answers and writes the bound ones back (the shared store's
 * saveFormResponse, same as the web app).
 */
export default function FormSheet({
  visible, template, projectId, leadId, prefill, customerName, onClose,
}: {
  visible: boolean
  template: FormTemplate
  projectId?: string
  leadId?: string
  prefill: Answers
  /** Kept for callers; the phone footer says "Complete" (the title names the form). */
  completeLabel: string
  customerName?: string
  onClose: () => void
}) {
  const p = useTheme()
  const user = useCurrentUser()
  const canEdit = can(user, projectId ? 'projects' : 'growth', 'edit')
  const saveFormResponse = useStore((s) => s.saveFormResponse)
  const response = useStore((s) =>
    s.formResponses.find((r) => r.form === template.key && (projectId ? r.projectId === projectId : r.leadId === leadId && !r.projectId)),
  )
  const [values, setValues] = useState<Answers>(() => response?.answers ?? prefill)
  const [showMissing, setShowMissing] = useState(false)
  const submitted = response?.status === 'submitted'
  const progress = formProgress(template, values)
  const customerReplied = Boolean(response?.customerSubmittedAt) && !submitted

  const save = (submit: boolean): boolean => {
    const result = saveFormResponse({ form: template.key, projectId, leadId, answers: values, submit })
    if (!result.ok) {
      setShowMissing(true)
      Alert.alert('Not saved yet', result.error ?? 'Could not save the form')
      return false
    }
    return true
  }

  return (
    <FormModal
      visible={visible}
      title={template.title}
      onClose={onClose}
      // Short on a phone: three footer buttons share one row. The full name
      // ("Complete onboarding") is the sheet's title.
      submitLabel={submitted ? 'Save' : 'Complete'}
      submitDisabled={!canEdit}
      onSubmit={() => {
        if (save(true)) onClose()
      }}
      footerLeft={
        canEdit && !submitted ? (
          <Button title="Draft" variant="ghost" onPress={() => save(false) && onClose()} />
        ) : undefined
      }
    >
      <View style={{ gap: 6 }}>
        {submitted ? (
          <Text style={{ fontSize: 13, fontFamily: fonts.sansMedium, color: p.success }}>
            Completed {fmtDate(response?.submittedAt)}. Changes still update the linked records.
          </Text>
        ) : customerReplied ? (
          <Text style={{ fontSize: 13, fontFamily: fonts.sansMedium, color: p.brandText }}>
            {customerName ?? 'The customer'} sent their answers {fmtDate(response?.customerSubmittedAt)}. Review them and complete the form.
          </Text>
        ) : (
          <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted, lineHeight: 19 }}>{template.description}</Text>
        )}
        <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: p.textMuted }}>
          {progress.done} of {progress.required} required answered
        </Text>
      </View>
      <FormFields
        template={template}
        values={values}
        onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
        disabled={!canEdit}
        showMissing={showMissing}
      />
    </FormModal>
  )
}
