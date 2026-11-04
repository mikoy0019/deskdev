import { useEffect } from 'react'
import { Feather } from '@expo/vector-icons'
import { useRouter, useSegments, type Href } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { GlassSurface, type BlurTargetRef } from '@/components/glass'
import { Avatar } from '@/components/ui'
import { useSession } from '@/context/session-context'
import { can } from '@/lib/permissions'
import { TAB_BAR_MAX_WIDTH } from '@/lib/responsive'
import { layout, motion, radius, useTheme } from '@/lib/theme'
import { useStore } from '@/store/useStore'
import type { FeatherIconName } from '@/components/ui'
import type { PermFeature } from '@/lib/types'

type Tab = {
  /** Route segment inside the (tabs) group. 'index' is the Home route. */
  name: string
  href: Href
  icon: FeatherIconName
  label: string
  /** Hidden when the user lacks view permission. */
  feature?: PermFeature
  /** Renders the user's avatar instead of a glyph, with an unread dot. */
  profile?: boolean
}

/** Side margin — the bar is near-full-bleed, not a small centred lozenge. */
const SIDE_MARGIN = 14
/** Inner padding between the capsule edge and the first/last tab. */
const PILL_PADDING = 6
/** Height of the active bubble; the bar is only a little taller. */
const BUBBLE_HEIGHT = 46

const TABS: Tab[] = [
  { name: 'index', href: '/', icon: 'home', label: 'Home' },
  { name: 'projects', href: '/projects', icon: 'briefcase', label: 'Projects', feature: 'projects' },
  { name: 'tasks', href: '/tasks', icon: 'check-square', label: 'Tasks', feature: 'tasks' },
  { name: 'calendar', href: '/calendar', icon: 'calendar', label: 'Calendar', feature: 'calendar' },
  { name: 'more', href: '/more', icon: 'menu', label: 'More', profile: true },
]

/**
 * Floating liquid-glass tab bar.
 *
 * Navigation runs through the router (useSegments + router.navigate) rather than
 * the navigator's `tabBar` props, so the bar can render as a SIBLING of the
 * content instead of a child of <Tabs>. That is not a style preference: Android's
 * BlurView blurs a BlurTargetView it sits *beside*. As a child of the navigator
 * it lived inside its own blur target and sampled a frame containing itself, so
 * nothing ever blurred.
 *
 * The pill hovers over the content, so tab screens must reserve
 * `layout.scrollClearance` at the bottom of their scrollers.
 */
export function FloatingTabBar({ blurTarget }: { blurTarget?: BlurTargetRef }) {
  const p = useTheme()
  const router = useRouter()
  const segments = useSegments()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { user } = useSession()
  const notifications = useStore((s) => s.notifications)

  const hasUnread = notifications.some((n) => n.userId === user?.id && !n.read)

  // Inside the (tabs) group the segments look like ['(tabs)', 'tasks'];
  // the Home route has no second segment.
  const active = ((segments as readonly string[])[1] as string | undefined) ?? 'index'

  const visible = TABS.filter((tab) => !tab.feature || can(user, tab.feature, 'view'))
  // Index within the VISIBLE tabs — permission-hidden tabs shift everything left,
  // so indexing into TABS would park the bubble under the wrong icon.
  const activeIndex = visible.findIndex((tab) => tab.name === active)

  // The bar spans the screen, so the tab stride depends on screen width and how
  // many tabs this user can actually see. It cannot be a constant — the bubble
  // is positioned by index × stride and would drift off the icons otherwise.
  // Capped on a tablet: five tabs across 1,100 px would put the icons a hand apart.
  const pillWidth = Math.min(width - SIDE_MARGIN * 2, TAB_BAR_MAX_WIDTH)
  const tabWidth = (pillWidth - PILL_PADDING * 2) / Math.max(visible.length, 1)

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { paddingBottom: Math.max(insets.bottom, layout.tabBarInset) + layout.tabBarInset },
      ]}
    >
      <GlassSurface
        blurTarget={blurTarget}
        intensity={90}
        style={[styles.pill, { width: pillWidth }]}
      >
        {/* One bubble for the whole bar, positioned by index — not one per tab.
            It has to sit outside the loop so it can travel between them. */}
        {activeIndex >= 0 ? (
          <TravellingBubble
            index={activeIndex}
            stride={tabWidth}
            width={tabWidth - 6}
            color={p.glassBubble}
          />
        ) : null}

        {visible.map((tab) => {
          const isFocused = active === tab.name

          const onPress = () => {
            if (isFocused) return
            // Selection = the lightest haptic there is; anything stronger turns
            // routine navigation into a buzzing annoyance.
            if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {})
            router.navigate(tab.href)
          }

          return (
            <Pressable
              key={tab.name}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={
                tab.profile && hasUnread ? `${tab.label}, unread notifications` : tab.label
              }
              style={[styles.item, { width: tabWidth }]}
            >
              {tab.profile && user ? (
                <View>
                  <Avatar name={user.fullName} colorClass={user.avatarColor} size={28} />
                  {hasUnread ? (
                    // A plain dot, not a count. The reference badge carries no
                    // number — it says "something's there", and a numeral at this
                    // size is unreadable anyway.
                    <View style={[styles.dot, { backgroundColor: p.danger, borderColor: p.glass }]} />
                  ) : null}
                </View>
              ) : (
                <Feather
                  name={tab.icon}
                  size={25}
                  // White throughout, brightness for state. Against a dense dark
                  // glass the muted ink greys used elsewhere simply disappear.
                  color={isFocused ? '#ffffff' : 'rgba(255,255,255,0.72)'}
                />
              )}
            </Pressable>
          )
        })}
      </GlassSurface>
    </View>
  )
}

/**
 * The active-tab bubble — ONE lens that travels, rather than one per tab fading
 * in and out. Fading is what made the old bar read as a lamp switching on; a
 * highlight that flows between tabs is what makes it read as liquid.
 *
 * Three things sell it:
 *
 *   1. A spring, not a timing curve. Liquid overshoots and settles; it does not
 *      ease politely to a stop.
 *   2. Stretch on launch. The lens elongates along its direction of travel and
 *      relaxes back to round — surface tension deforming under acceleration.
 *   3. A trailing blob on a slower, floppier spring. It lags behind the lens and
 *      catches up late, so the highlight looks like it's dragging mass with it
 *      instead of teleporting.
 */
function TravellingBubble({
  index,
  stride,
  width,
  color,
}: {
  index: number
  stride: number
  width: number
  color: string
}) {
  const x = useSharedValue(index * stride)
  const trail = useSharedValue(index * stride)
  const stretch = useSharedValue(1)

  useEffect(() => {
    const target = index * stride

    // Lead: quick, lightly springy.
    x.value = withSpring(target, { damping: 16, stiffness: 190, mass: 0.7 })
    // Trail: slower and floppier, so it arrives a beat later.
    trail.value = withSpring(target, { damping: 11, stiffness: 90, mass: 1.1 })
    // Squash-and-stretch: elongate, then relax.
    stretch.value = withSequence(
      withTiming(1.28, { duration: 110 }),
      withSpring(1, { damping: 10, stiffness: 170 }),
    )
  }, [index, stride, x, trail, stretch])

  const lead = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { scaleX: stretch.value }],
  }))

  // The trail is dimmer and scaled up — a soft echo of the lens, standing in for
  // a real gooey merge (which would need a shader).
  const follow = useAnimatedStyle(() => ({
    transform: [{ translateX: trail.value }, { scale: 1.05 }],
    opacity: 0.5,
  }))

  const shape = { width, height: BUBBLE_HEIGHT, backgroundColor: color }

  return (
    <>
      <Animated.View
        style={[styles.bubble, shape, follow]}
        accessibilityElementsHidden
        importantForAccessibility="no"
        pointerEvents="none"
      />
      <Animated.View
        style={[styles.bubble, shape, lead]}
        accessibilityElementsHidden
        importantForAccessibility="no"
        pointerEvents="none"
      />
    </>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: layout.tabBarHeight,
    paddingHorizontal: PILL_PADDING,
  },
  item: {
    // Width is set inline (screen-derived); height keeps a ≥44px touch target.
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: {
    position: 'absolute',
    left: PILL_PADDING + 3,
    top: (layout.tabBarHeight - BUBBLE_HEIGHT) / 2,
    // A soft rounded rectangle, not a full capsule — matches the reference,
    // where the active shape is a squircle sitting inside the pill.
    borderRadius: radius.lg + 6,
  },
  dot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
  },
})
