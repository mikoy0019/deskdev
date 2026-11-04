import { Feather } from '@expo/vector-icons'
import { Image } from 'expo-image'
import React, {
  useEffect, useRef, useState, type ComponentProps, type ReactNode, type Ref,
} from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context'

import { avatarImageUrl } from '@/lib/avatarImages'
import { avatarColor, initials } from '@/lib/format'
import { centeredColumn, SHEET_MAX_WIDTH, useResponsive } from '@/lib/responsive'
import {
  avatarHex, fonts, layout, radius, rgba, space, useTheme, type ChipColors,
} from '@/lib/theme'
import { useStore } from '@/store/useStore'

export type FeatherIconName = ComponentProps<typeof Feather>['name']

// ─── Screen ──────────────────────────────────────────────────────────────────

interface ScreenProps {
  children: ReactNode
  /** Wrap content in a ScrollView. */
  scroll?: boolean
  /** Apply default 16px padding. */
  padded?: boolean
  /**
   * Rendered above the scroll area and outside `padded`, so a <ScreenHeader>
   * keeps its own gutter instead of being double-padded — and stays pinned
   * while the content scrolls under it.
   */
  header?: ReactNode
  /**
   * Set on the five tab screens. Adds the top safe-area inset (they have no
   * native header anymore) and reserves bottom room for the floating tab pill.
   * Non-scrolling tab screens (the kanban boards) pad their own scrollers.
   */
  tabScreen?: boolean
  /**
   * Safe-area edges. Screens under a native header need none (the default);
   * headerless ones (e.g. login) should pass ['top', 'bottom'].
   */
  edges?: Edge[]
  style?: StyleProp<ViewStyle>
  /**
   * Use the whole width on a tablet too (boards, the calendar, tables).
   * Without it, a tablet shows the screen as a centred reading column.
   */
  wide?: boolean
}

/** Themed page background + optional safe area + optional scroll; a centred column on tablets. */
export function Screen({
  children,
  scroll = false,
  padded = true,
  header,
  tabScreen = false,
  edges,
  style,
  wide = false,
}: ScreenProps) {
  const p = useTheme()
  const { readingMaxWidth } = useResponsive()
  const safeEdges: Edge[] = edges ?? (tabScreen ? ['top'] : [])
  const column = wide ? undefined : centeredColumn(readingMaxWidth)

  return (
    <SafeAreaView edges={safeEdges} style={[styles.flex, { backgroundColor: p.page }]}>
      {header ? <View style={column}>{header}</View> : null}
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            column,
            padded && styles.padded,
            tabScreen && { paddingBottom: layout.scrollClearance },
            style,
          ]}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, column, padded && styles.padded, style]}>{children}</View>
      )}
    </SafeAreaView>
  )
}

// ─── ScreenHeader ────────────────────────────────────────────────────────────

interface ScreenHeaderProps {
  /** Display-font page title, e.g. "Tasks". */
  title: string
  /** Muted line under the title — a count, a date range, a status. */
  subtitle?: string
  /** Right-aligned actions. Use <HeaderAction> children. */
  actions?: ReactNode
}

/**
 * The app's page header. Replaces the native navigator header, which stacked a
 * tall opaque bar on top of the screen's own count/actions row — two competing
 * headers, hence the "weird header" look.
 *
 * This collapses them into one row: title + subtitle on the left, actions on
 * the right, aligned to the same 16px gutter as the content below it. Screens
 * that use this must set `headerShown: false`.
 */
export function ScreenHeader({ title, subtitle, actions }: ScreenHeaderProps) {
  const p = useTheme()
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text numberOfLines={1} style={[styles.headerTitle, { color: p.textHigh }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={[styles.headerSubtitle, { color: p.textMuted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actions ? <View style={styles.headerActions}>{actions}</View> : null}
    </View>
  )
}

interface HeaderActionProps {
  label: string
  icon: FeatherIconName
  onPress: () => void
  /** Renders in the brand color — for the one primary action per header. */
  accent?: boolean
}

/** An icon+label action for <ScreenHeader actions>. */
export function HeaderAction({ label, icon, onPress, accent }: HeaderActionProps) {
  const p = useTheme()
  const color = accent ? p.brandText : p.textSecondary
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.headerAction, pressed && { opacity: 0.6 }]}
    >
      <Feather name={icon} size={15} color={accent ? p.brandText : p.iconMuted} />
      <Text
        style={{
          fontSize: 13,
          fontFamily: accent ? fonts.sansSemibold : fonts.sansMedium,
          color,
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

// ─── Card ────────────────────────────────────────────────────────────────────

interface CardProps {
  children: ReactNode
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}

/** Web `.card`: bg-ink-800 border-ink-600 rounded-xl. */
export function Card({ children, onPress, style }: CardProps) {
  const p = useTheme()
  const base: ViewStyle = {
    backgroundColor: p.card,
    borderColor: p.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 14,
  }
  if (!onPress) return <View style={[base, style]}>{children}</View>
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        base,
        pressed && { backgroundColor: p.hover, borderColor: p.borderStrong },
        style,
      ]}
    >
      {children}
    </Pressable>
  )
}

// ─── Chip ────────────────────────────────────────────────────────────────────

interface ChipProps {
  label: string
  /** From theme helpers: accentChip / neutralChip / *StatusChip. */
  colors: ChipColors
  style?: StyleProp<ViewStyle>
}

/** Tinted pill matching the web chip look (accent/15 bg + accent/30 border). */
export function Chip({ label, colors, style }: ChipProps) {
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: colors.bg, borderColor: colors.border },
        style,
      ]}
    >
      <Text style={[styles.chipText, { color: colors.text }]}>{label}</Text>
    </View>
  )
}

// ─── FilterChip ──────────────────────────────────────────────────────────────

interface FilterChipProps {
  label: string
  active: boolean
  /** Optional colour dot before the label (status/category pickers use this). */
  dot?: string
  onPress: () => void
}

/* ── Loading (content-shaped, opacity-only pulse) ─────────────────────────────
 * Lifted out of (tabs)/index.tsx, where it was defined but usable only by Home —
 * every other tab flashed an empty state while the session resolved. DESIGN.md #1
 * asks for a skeleton shaped like the content, never a spinner in a void.
 */

export function Skeleton({
  w,
  h,
  r = radius.sm,
  style,
}: {
  w: number | `${number}%`
  h: number
  r?: number
  style?: StyleProp<ViewStyle>
}) {
  const p = useTheme()
  const o = useRef(new Animated.Value(0.5)).current

  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined
    let cancelled = false

    // An indefinite pulse is exactly what "reduce motion" is for. Hold it at a
    // steady opacity instead of animating.
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return
      if (reduced) {
        o.setValue(0.7)
        return
      }
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(o, { toValue: 0.9, duration: 700, useNativeDriver: true }),
          Animated.timing(o, { toValue: 0.5, duration: 700, useNativeDriver: true }),
        ]),
      )
      loop.start()
    })

    return () => {
      cancelled = true
      loop?.stop()
    }
  }, [o])

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[{ width: w, height: h, borderRadius: r, backgroundColor: p.hover, opacity: o }, style]}
    />
  )
}

/** A stat tile in its loading state. */
export function StatSkeleton() {
  return (
    <Card style={{ flex: 1, minWidth: 150 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Skeleton w="52%" h={10} />
        <Skeleton w={30} h={30} r={radius.md} />
      </View>
      <Skeleton w={64} h={28} r={radius.sm} style={{ marginTop: space.md }} />
    </Card>
  )
}

/** A list row in its loading state: avatar + two lines. */
export function RowSkeleton() {
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Skeleton w={26} h={26} r={13} />
        <View style={{ flex: 1, gap: space.sm }}>
          <Skeleton w="70%" h={12} />
          <Skeleton w="40%" h={10} />
        </View>
      </View>
    </Card>
  )
}

/** `count` stacked RowSkeletons — the common "list is loading" case. */
export function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={{ gap: space.sm }} accessibilityLabel="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <RowSkeleton key={i} />
      ))}
    </View>
  )
}

/**
 * Selectable pill for the client/status filter rows.
 *
 * Sized by `minHeight` rather than vertical padding, so a parent can never
 * clip the text: the old copies were 31px tall inside a row capped at 52px
 * with 24px of padding, which sheared the bottom off every client name.
 */
export function FilterChip({ label, active, dot, onPress }: FilterChipProps) {
  const p = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.filterChip,
        {
          backgroundColor: active ? p.brand : p.card,
          borderColor: active ? p.brand : p.border,
        },
        pressed && !active && { backgroundColor: p.hover },
      ]}
    >
      {dot ? <View style={[styles.filterChipDot, { backgroundColor: dot }]} /> : null}
      <Text
        numberOfLines={1}
        style={[styles.filterChipText, { color: active ? '#ffffff' : p.textSecondary }]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

// ─── Button ──────────────────────────────────────────────────────────────────

interface ButtonProps {
  title: string
  onPress: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  icon?: FeatherIconName
  disabled?: boolean
  loading?: boolean
  style?: StyleProp<ViewStyle>
}

export function Button({
  title, onPress, variant = 'primary', icon, disabled, loading, style,
}: ButtonProps) {
  const p = useTheme()
  const isGhost = variant === 'ghost'
  const bg = variant === 'primary' ? p.brand : variant === 'danger' ? p.danger : 'transparent'
  const fg = isGhost ? p.textSecondary : '#ffffff'
  const blocked = disabled || loading
  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg },
        isGhost && { borderWidth: 1, borderColor: p.borderStrong },
        pressed && (isGhost ? { backgroundColor: p.hover } : { opacity: 0.9 }),
        pressed && { transform: [{ translateY: StyleSheet.hairlineWidth }] },
        blocked && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {icon ? <Feather name={icon} size={16} color={fg} /> : null}
          <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  )
}

// ─── Input & Label ───────────────────────────────────────────────────────────

/** Web `.input`: hover-surface bg, strong border, high-contrast text. */
export function Input({ style, ref, ...props }: TextInputProps & { ref?: Ref<TextInput> }) {
  const p = useTheme()
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={p.textMuted}
      {...props}
      style={[
        styles.input,
        {
          backgroundColor: p.hover,
          borderColor: p.borderStrong,
          color: p.textHigh,
        },
        style,
      ]}
    />
  )
}

export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const p = useTheme()
  return <Text style={[styles.label, { color: p.textSecondary }, style]}>{children}</Text>
}

// ─── SectionTitle ────────────────────────────────────────────────────────────

/** Web `.section-title`: xs semibold uppercase tracking-wider. */
export function SectionTitle({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const p = useTheme()
  return (
    <Text style={[styles.sectionTitle, { color: p.textSecondary }, style]}>
      {children}
    </Text>
  )
}

// ─── EmptyState ──────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon?: FeatherIconName
  title: string
  hint?: string
  action?: ReactNode
}

export function EmptyState({ icon = 'inbox', title, hint, action }: EmptyStateProps) {
  const p = useTheme()
  return (
    <Card style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: p.hover, borderColor: p.border }]}>
        <Feather name={icon} size={24} color={p.iconMuted} />
      </View>
      <Text style={[styles.emptyTitle, { color: p.textHigh }]}>{title}</Text>
      {hint ? <Text style={[styles.emptyHint, { color: p.textMuted }]}>{hint}</Text> : null}
      {action ? <View style={{ marginTop: 16 }}>{action}</View> : null}
    </Card>
  )
}

// ─── Avatar ──────────────────────────────────────────────────────────────────

interface AvatarProps {
  name: string
  /** Tailwind bg class (User.avatarColor) — falls back to avatarColor(name). */
  colorClass?: string
  /**
   * The picture key (User.avatarKey / Client.avatarKey, 052). Left out, a
   * user's picture is looked up by name like the web's Avatar; null means none.
   */
  imageKey?: string | null
  size?: number
}

export function Avatar({ name, colorClass, imageKey, size = 32 }: AvatarProps) {
  const bg = avatarHex(colorClass ?? avatarColor(name))
  const pickedKey = useStore((s) => (imageKey !== undefined ? undefined : s.users.find((u) => u.fullName === name)?.avatarKey))
  const key = imageKey === undefined ? pickedKey : imageKey ?? undefined
  // A picture that fails to load (deleted, offline) falls back to the initials.
  const [broken, setBroken] = useState<string | null>(null)
  const uri = key && key !== broken ? avatarImageUrl(key) : undefined
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg }}
        contentFit="cover"
        cachePolicy="memory-disk"
        accessibilityIgnoresInvertColors
        onError={() => setBroken(key ?? null)}
      />
    )
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#ffffff', fontFamily: fonts.sansBold, fontSize: size * 0.38 }}>
        {initials(name)}
      </Text>
    </View>
  )
}

// ─── Fab ─────────────────────────────────────────────────────────────────────

interface FabProps {
  icon?: FeatherIconName
  onPress: () => void
  /**
   * Set on screens inside the tab navigator so the button clears the floating
   * tab pill instead of hiding behind it. Off for full-screen/stack routes,
   * which have no pill.
   */
  aboveTabBar?: boolean
}

/** Floating action button — brand circle, bottom right. */
export function Fab({ icon = 'plus', onPress, aboveTabBar = false }: FabProps) {
  const p = useTheme()
  const insets = useSafeAreaInsets()
  const bottom = aboveTabBar
    ? Math.max(insets.bottom, layout.tabBarInset) + layout.scrollClearance
    : space.xl

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.fab,
        {
          bottom,
          backgroundColor: p.brand,
          shadowColor: rgba(p.brand, 1),
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Feather name={icon} size={24} color="#ffffff" />
    </Pressable>
  )
}

// ─── ActionSheet ───────────────────────────────────────────────────────────────

export interface SheetAction {
  label: string
  icon?: FeatherIconName
  onPress: () => void
  /** Renders the row in the danger color (for deletes etc.). */
  destructive?: boolean
}

interface ActionSheetProps {
  visible: boolean
  /** Optional header label (e.g. the entity name). */
  title?: string
  actions: SheetAction[]
  onClose: () => void
}

/** Themed bottom sheet menu — the app's replacement for the native Alert menu. */
export function ActionSheet({ visible, title, actions, onClose }: ActionSheetProps) {
  const p = useTheme()
  const { isTablet } = useResponsive()
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={[styles.sheetOverlay, { backgroundColor: p.overlay }]} onPress={onClose}>
        <SafeAreaView edges={['bottom']}>
          <View style={[styles.sheetContainer, isTablet ? centeredColumn(SHEET_MAX_WIDTH) : null]}>
            {/* Absorbs taps so pressing the sheet itself doesn't dismiss it. */}
            <Pressable
              style={[styles.sheetGroup, { backgroundColor: p.card, borderColor: p.border }]}
              onPress={() => {}}
            >
              {title ? (
                <View style={[styles.sheetHeader, { borderBottomColor: p.border }]}>
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: 13, fontFamily: fonts.sansSemibold, color: p.textMuted }}
                  >
                    {title}
                  </Text>
                </View>
              ) : null}
              {actions.map((a, i) => (
                <Pressable
                  key={a.label}
                  onPress={() => {
                    onClose()
                    a.onPress()
                  }}
                  style={({ pressed }) => [
                    styles.sheetRow,
                    (title || i > 0) && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.border },
                    pressed && { backgroundColor: p.hover },
                  ]}
                >
                  {a.icon ? (
                    <Feather name={a.icon} size={19} color={a.destructive ? p.danger : p.textSecondary} />
                  ) : null}
                  <Text
                    style={{ fontSize: 16, fontFamily: fonts.sansMedium, color: a.destructive ? p.danger : p.text }}
                  >
                    {a.label}
                  </Text>
                </Pressable>
              ))}
            </Pressable>

            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                styles.sheetCancel,
                { backgroundColor: p.card, borderColor: p.border },
                pressed && { backgroundColor: p.hover },
              ]}
            >
              <Text style={{ fontSize: 16, fontFamily: fonts.sansSemibold, color: p.brandText }}>Cancel</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Pressable>
    </Modal>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padded: { padding: 16 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 11,
    fontFamily: fonts.sansMedium,
    letterSpacing: 0.2,
    fontVariant: ['tabular-nums'],
  },
  filterChip: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  filterChipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  filterChipText: {
    fontSize: 13,
    fontFamily: fonts.sansSemibold,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radius.md,
  },
  buttonText: { fontSize: 14, fontFamily: fonts.sansSemibold },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: fonts.sans,
  },
  label: {
    fontSize: 12,
    fontFamily: fonts.sansSemibold,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: fonts.sansSemibold,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 8,
    gap: 6,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emptyTitle: { fontSize: 16, fontFamily: fonts.display },
  emptyHint: {
    fontSize: 13,
    fontFamily: fonts.sans,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 12,
    maxWidth: 320,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  headerText: { flex: 1, gap: 2 },
  headerTitle: {
    fontSize: 26,
    fontFamily: fonts.display,
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    fontSize: 12,
    fontFamily: fonts.mono,
    fontVariant: ['tabular-nums'],
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  headerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 1,
    minHeight: 32,
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 8,
  },
  sheetGroup: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sheetHeader: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 15,
    paddingHorizontal: 18,
  },
  sheetCancel: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 15,
    alignItems: 'center',
  },
})
