import { useMemo, useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Alert, ScrollView, Text, View } from 'react-native'

import { STATUS_LABEL, ShowcaseThumb, statusChip } from '@/components/portfolio/showcaseBits'
import { Card, Chip, EmptyState, Fab, FilterChip, ListSkeleton, Screen } from '@/components/ui'
import { can } from '@/lib/permissions'
import { compareShowcase, publishChecklist } from '@/lib/showcase'
import { fonts, space, useTheme } from '@/lib/theme'
import type { ShowcaseItem, ShowcaseStatus } from '@/lib/types'
import { useCurrentUser, useStore } from '@/store/useStore'

// The portfolio desk on the phone: what nixgensolutions.com/portfolio shows.
// A project marked done with a live URL drafts an entry on its own; the
// developer fills it in and marks it ready; an admin publishes it. Mirrors
// the web's pages/Showcase.tsx.

type Tab = 'review' | 'live' | 'off' | 'all'

const TABS: { id: Tab; label: string; statuses: ShowcaseStatus[] | null }[] = [
  { id: 'review', label: 'To finish', statuses: ['draft', 'ready'] },
  { id: 'live', label: 'Live', statuses: ['published'] },
  { id: 'off', label: 'Hidden & archived', statuses: ['hidden', 'archived'] },
  { id: 'all', label: 'All', statuses: null },
]

function EntryCard({ item, onPress }: { item: ShowcaseItem; onPress: () => void }) {
  const p = useTheme()
  const project = useStore((s) => (item.projectId ? s.projects.find((pr) => pr.id === item.projectId) : undefined))
  const checklist = publishChecklist(item)
  const done = checklist.filter((c) => c.ok).length
  const subtitle = [item.industry, project ? `from ${project.title}` : null].filter(Boolean).join(' · ') || 'No industry set'

  return (
    <Card onPress={onPress} style={{ padding: 0, overflow: 'hidden' }}>
      <ShowcaseThumb item={item} p={p} style={{ borderRadius: 0 }} />
      <View style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {item.featured ? <Feather name="star" size={13} color={p.warn} accessibilityLabel="Featured" /> : null}
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontFamily: fonts.sansSemibold, color: p.textHigh }}>
                {item.title || 'Untitled'}
              </Text>
            </View>
            <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, marginTop: 2 }}>{subtitle}</Text>
          </View>
          <Chip label={STATUS_LABEL[item.status]} colors={statusChip(p, item.status)} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View
            style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: p.hover, overflow: 'hidden' }}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: checklist.length, now: done }}
            accessibilityLabel="Publish checklist"
          >
            <View
              style={{
                width: `${Math.round((done / checklist.length) * 100)}%`,
                height: '100%',
                borderRadius: 3,
                backgroundColor: done === checklist.length ? p.success : p.brand,
              }}
            />
          </View>
          <Text style={{ fontSize: 11, fontFamily: fonts.mono, color: p.textMuted, fontVariant: ['tabular-nums'] }}>
            {done}/{checklist.length}
          </Text>
        </View>
      </View>
    </Card>
  )
}

export default function Portfolio() {
  const p = useTheme()
  const router = useRouter()
  const user = useCurrentUser()
  const canEdit = can(user, 'showcase', 'edit')
  const hydrated = useStore((s) => s.hydrated)
  const items = useStore((s) => s.showcaseItems)
  const addShowcaseItem = useStore((s) => s.addShowcaseItem)
  const [tab, setTab] = useState<Tab>('review')

  const counts = useMemo(() => {
    const c = {} as Record<Tab, number>
    for (const t of TABS) c[t.id] = t.statuses ? items.filter((i) => t.statuses!.includes(i.status)).length : items.length
    return c
  }, [items])

  const shown = useMemo(() => {
    const statuses = TABS.find((t) => t.id === tab)?.statuses
    return items.filter((i) => !statuses || statuses.includes(i.status)).sort(compareShowcase)
  }, [items, tab])

  const create = () => {
    const id = addShowcaseItem({ title: 'New portfolio entry' })
    if (id) router.push(`/portfolio/${id}`)
    else Alert.alert('Not created', 'You need edit access to the portfolio.')
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: canEdit ? 92 : 16 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg }}>
          {TABS.map((t) => (
            <FilterChip key={t.id} label={`${t.label} ${counts[t.id]}`} active={tab === t.id} onPress={() => setTab(t.id)} />
          ))}
        </View>

        {!hydrated && items.length === 0 ? (
          <ListSkeleton count={3} />
        ) : shown.length === 0 ? (
          <EmptyState
            icon="image"
            title={tab === 'review' ? 'Nothing to finish' : 'No entries here'}
            hint={
              tab === 'review'
                ? 'When a project is marked done with a live URL, its portfolio draft appears here for the developer to fill in.'
                : 'Entries move here as they are published, hidden or archived.'
            }
          />
        ) : (
          <View style={{ gap: 12 }}>
            {shown.map((item) => (
              <EntryCard key={item.id} item={item} onPress={() => router.push(`/portfolio/${item.id}`)} />
            ))}
          </View>
        )}
      </ScrollView>
      {canEdit ? <Fab icon="plus" onPress={create} /> : null}
    </Screen>
  )
}
