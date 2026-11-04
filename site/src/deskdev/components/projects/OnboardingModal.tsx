import { useMemo } from 'react'
import FormModal from '../forms/FormModal'
import { useStore } from '../../store/useStore'
import { ONBOARDING_FORM, onboardingPrefill } from '../../lib/forms'
import type { Project } from '../../lib/types'

// The project's onboarding form, filled in with the client at kickoff (or by
// them, through "Send to client"). It starts from what is already known — the
// website enquiry the client was converted from, the client record, the
// project — and on completion writes the bound answers (email, phone, launch
// date, budget, portfolio consent) back onto the client and project.
// Completing it unlocks "Proceed to development".

/** The enquiry this client came from: the newest lead converted into it. */
export function useOriginLead(clientId: string) {
  const leads = useStore((s) => s.leads)
  return useMemo(
    () => leads.filter((l) => l.clientId === clientId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0],
    [leads, clientId],
  )
}

export default function OnboardingModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const client = useStore((s) => s.clients.find((c) => c.id === project.clientId))
  const lead = useOriginLead(project.clientId)
  return (
    <FormModal
      template={ONBOARDING_FORM}
      projectId={project.id}
      prefill={onboardingPrefill({ project, client, lead })}
      prefillNote={lead ? 'Answers from their website enquiry are filled in already.' : undefined}
      completeLabel="Complete onboarding"
      completedToast="Onboarding complete — client and project details updated"
      customerName={lead?.name ?? client?.name}
      onClose={onClose}
    />
  )
}
