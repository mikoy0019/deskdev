import { useRef, type ReactNode, type RefObject } from 'react'
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { BlurTargetView, BlurView } from 'expo-blur'
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'

import { radius as radiusScale, useTheme } from '@/lib/theme'

// ─── Why this exists ─────────────────────────────────────────────────────────
// Three materials produce the same "floating glass" look, and which one is
// available depends entirely on the platform:
//
//   iOS 26+   expo-glass-effect's real Liquid Glass (refraction + specular
//             edge). The good one. iOS/tvOS ONLY — GlassView degrades to a plain
//             View everywhere else, which is why Android needs its own path.
//   Android   expo-blur's BlurView, which samples a *target* view.
//   Neither   A translucent fill + lit top edge, carried by the glass tokens.
//
// The Android rule that shapes this whole file: BlurView does not blur "whatever
// is behind it" — it blurs a BlurTargetView, and the two must be SIBLINGS. Nest
// the BlurView inside its own target and it samples a frame containing itself,
// so nothing blurs. That constraint is why the tab bar is rendered outside the
// navigator (see app/(tabs)/_layout.tsx) rather than as its `tabBar` prop.

const LIQUID_GLASS = isLiquidGlassAvailable()

export type BlurTargetRef = RefObject<View | null>

/** Creates the ref linking a <BlurTarget> to the <GlassSurface> that samples it. */
export function useBlurTarget(): BlurTargetRef {
  return useRef<View>(null)
}

/**
 * Wraps the content a glass surface should blur. Must be a *sibling* of the
 * surface, not its parent. Only Android samples it; elsewhere it's a plain View.
 */
export function BlurTarget({
  targetRef,
  children,
  style,
}: {
  targetRef: BlurTargetRef
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  if (Platform.OS !== 'android') {
    return <View style={[styles.fill, style]}>{children}</View>
  }
  return (
    <BlurTargetView ref={targetRef} style={[styles.fill, style]}>
      {children}
    </BlurTargetView>
  )
}

interface GlassSurfaceProps {
  children?: ReactNode
  /** The <BlurTarget> to sample. Required for a real blur on Android. */
  blurTarget?: BlurTargetRef
  /** Blur strength, 1–100. Ignored under real Liquid Glass (the OS decides). */
  intensity?: number
  /** Corner radius. Defaults to a pill so the common case is one prop shorter. */
  radius?: number
  style?: StyleProp<ViewStyle>
}

/**
 * A surface that floats *over* content: the tab bar, sheets, overlay chrome.
 *
 * Glass is a stack, not a property — no single style produces it:
 *
 *   drop shadow   → outer wrapper. It CANNOT live on the clipping container:
 *                   `overflow: hidden` maps to masksToBounds on iOS, which clips
 *                   the layer's own shadow away, so the pill looks painted on.
 *   ── clip ────────────────────────────────────────────────────────────────
 *   blur          → BlurView sampling the sibling BlurTarget
 *   tint          → smoky fill; must sit ABOVE the blur or it is never seen
 *   gradient      → top-to-bottom brightness falloff — the "liquid" variation
 *   reflections   → inset shadows: bright top rim, dark bottom rim
 *   children      → icons
 */
export function GlassSurface({
  children,
  blurTarget,
  intensity = 80,
  radius = radiusScale.pill,
  style,
}: GlassSurfaceProps) {
  const p = useTheme()

  if (LIQUID_GLASS) {
    // iOS 26 renders all of the above as one real material — refraction and
    // specular edges included. Painting fake highlights over it would only
    // muddy it, so the imitation layers are skipped entirely here.
    return (
      <GlassView
        glassEffectStyle="regular"
        isInteractive
        style={[{ borderRadius: radius, overflow: 'hidden' }, style]}
      >
        {children}
      </GlassView>
    )
  }

  return (
    // No cast shadow. A drop shadow under a translucent surface reads as a dark
    // halo smeared across whatever is behind it — the opposite of glass, which
    // should look like it's *made of* the background, not sitting on top of it.
    // Depth comes from the inset reflections (lit top rim, shadowed bottom) and
    // the edge hairline instead.
    <View
      style={[
        // overflow:hidden is what makes borderRadius actually clip the blur
        // layer on both platforms (expo-blur documents this explicitly).
        { borderRadius: radius, overflow: 'hidden' },
        { borderWidth: 1, borderColor: p.glassBorder, boxShadow: p.glassReflections },
        style,
      ]}
    >
      <BlurView
        tint={p.blurTint}
        intensity={intensity}
        // Android divides intensity by this before blurring (default 4), so an
        // iOS-calibrated value lands a quarter as strong. 2 closes the gap
        // without turning the pill into frosted mud.
        blurReductionFactor={2}
        // NOTE: neither Android blur method renders on the Android *emulator*
        // (GPU emulation does no RenderEffect/RenderScript), verified with the
        // sibling BlurTarget wiring correct. The tint/gradient/reflections
        // are tuned to carry the look without it, so a device that cannot blur
        // still gets a credible glass pill rather than a flat grey bar.
        blurMethod="dimezisBlurViewSdk31Plus"
        blurTarget={blurTarget}
        style={StyleSheet.absoluteFill}
      />
      {/* Tint + gradient sit ABOVE the blur: a backgroundColor on the container
          would be painted behind it and never seen. */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: p.glass, experimental_backgroundImage: p.glassGradient },
        ]}
      />
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
