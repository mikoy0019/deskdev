import { useLocalSearchParams } from 'expo-router'

import ShowcaseEditor from '@/components/portfolio/ShowcaseEditor'
import { EmptyState, ListSkeleton, Screen } from '@/components/ui'
import { useStore } from '@/store/useStore'

/**
 * One portfolio entry (/portfolio/<id>) — opened from the Portfolio list, a
 * project page or a showcase_ready notification. The editor keys on the id,
 * so a different entry starts a fresh form.
 */
export default function PortfolioEntry() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const item = useStore((s) => s.showcaseItems.find((i) => i.id === id))
  const hydrated = useStore((s) => s.hydrated)

  if (!item) {
    return (
      <Screen>
        {hydrated ? (
          <EmptyState icon="alert-circle" title="Entry not found" hint="It may have been deleted, or the link is out of date." />
        ) : (
          <ListSkeleton count={2} />
        )}
      </Screen>
    )
  }

  return <ShowcaseEditor key={item.id} item={item} />
}
