import { Chip } from '@/components/ui'
import { PHASE_LABEL } from '@/lib/projectPhase'
import { accentChip, type Accent } from '@/lib/theme'
import type { ProjectPhase } from '@/lib/types'

const PHASE_ACCENT: Record<ProjectPhase, Accent> = {
  onboarding: 'amber',
  development: 'brand',
  launched: 'emerald',
}

/** A project's stage (046). Pass phaseOf(project), not project.phase (rows from before 046 have none). */
export function PhaseChip({ phase }: { phase: ProjectPhase }) {
  return <Chip label={PHASE_LABEL[phase]} colors={accentChip(PHASE_ACCENT[phase])} />
}
