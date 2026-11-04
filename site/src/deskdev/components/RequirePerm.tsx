import type { ReactNode } from 'react'
import { ArrowLeftIcon, ShieldWarningIcon } from '@phosphor-icons/react'
import { Link } from 'react-router-dom'
import type { PermFeature } from '../lib/types'
import { can } from '../lib/permissions'
import { useCurrentUser } from '../store/useStore'
import Layout from './Layout'

const FEATURE_LABEL: Record<PermFeature, string> = {
  projects: 'Projects',
  tasks: 'Tasks',
  clients: 'Clients',
  crm: 'CRM',
  calendar: 'Calendar',
  meetings: 'Meetings',
  growth: 'Growth Hub',
  courses: 'Courses',
  showcase: 'Showcase',
}

/** Renders children only when the current user can view the feature. */
export default function RequirePerm({
  feature,
  children,
}: {
  feature: PermFeature
  children: ReactNode
}) {
  const user = useCurrentUser()

  if (!can(user, feature, 'view')) {
    return (
      <Layout title="No access">
        {/* No card: a composed block on the page, left-aligned like the
            content it stands in for. */}
        <div className="mx-auto max-w-6xl">
          <div className="max-w-md pt-6 md:pt-16">
            <div className="flex size-12 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/15">
              <ShieldWarningIcon size={22} className="text-amber-700 dark:text-amber-400" aria-hidden />
            </div>
            <h2 className="mt-5 text-display text-xl font-semibold text-ink-50">
              No access to {FEATURE_LABEL[feature]}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-200 text-pretty">
              Your account doesn&apos;t have permission to view this area. Ask a
              workspace admin to grant you access.
            </p>
            <Link to="/" className="btn-secondary mt-6 pointer-coarse:min-h-11">
              <ArrowLeftIcon size={14} aria-hidden />
              Back home
            </Link>
          </div>
        </div>
      </Layout>
    )
  }

  return <>{children}</>
}
