import { Feather } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { View, type StyleProp, type ViewStyle } from 'react-native'

import { showcaseImageUrl } from '@/lib/showcaseImages'
import { accentChip, neutralChip, radius, type ChipColors, type Palette } from '@/lib/theme'
import type { ShowcaseConsent, ShowcaseItem, ShowcaseKind, ShowcaseStatus } from '@/lib/types'

// Labels and small pieces for the Portfolio screens — the mobile counterpart
// of the web's components/showcase/showcaseBits.tsx.

export const STATUS_LABEL: Record<ShowcaseStatus, string> = {
  draft: 'Draft',
  ready: 'Ready for review',
  published: 'Live on site',
  hidden: 'Hidden',
  archived: 'Archived',
}

export function statusChip(p: Palette, status: ShowcaseStatus): ChipColors {
  switch (status) {
    case 'ready': return accentChip('amber')
    case 'published': return accentChip('emerald')
    default: return neutralChip(p)
  }
}

export const KIND_LABEL: Record<ShowcaseKind, string> = {
  website: 'Website',
  web_app: 'Web app',
  product: 'Our product',
}

export const CONSENT_LABEL: Record<ShowcaseConsent, string> = {
  unknown: 'Not asked yet',
  granted: 'Granted',
  declined: 'Declined',
  legacy: 'Legacy (was already public)',
  internal: 'Internal (our own work)',
}

/** The entry's screenshot at 16:10, or a quiet placeholder. */
export function ShowcaseThumb({
  item, p, large = false, style,
}: {
  item: Pick<ShowcaseItem, 'imageKey' | 'imageKeySmall' | 'imageAlt'>
  p: Palette
  /** The 1280 px image (the editor's preview) instead of the 640 px one. */
  large?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const uri = showcaseImageUrl(large ? item.imageKey ?? item.imageKeySmall : item.imageKeySmall ?? item.imageKey)
  return (
    <View
      style={[
        { width: '100%', aspectRatio: 16 / 10, backgroundColor: p.hover, borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
        style,
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          transition={150}
          accessibilityLabel={item.imageAlt || undefined}
        />
      ) : (
        <Feather name="image" size={26} color={p.iconMuted} />
      )}
    </View>
  )
}
