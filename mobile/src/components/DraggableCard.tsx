import type { ReactNode } from 'react'
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import * as Haptics from 'expo-haptics'
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

import { motion, radius, useTheme } from '@/lib/theme'

/** Horizontal travel (px) before a release commits a column move. */
const COMMIT_DISTANCE = 64
/** Hold time before the card detaches and follows the finger. */
const HOLD_MS = 300
/** How far a card can be dragged toward a column that does not exist. */
const RUBBER_BAND = 28

export type MoveDirection = -1 | 1

interface DraggableCardProps {
  children: ReactNode
  /** Commit a move to the previous (-1) or next (+1) column. */
  onMove: (direction: MoveDirection) => void
  /** Double-tap target — opens the edit form. */
  onOpen: () => void
  /** False at the first column: drags left rubber-band instead of committing. */
  canMoveLeft: boolean
  /** False at the last column. */
  canMoveRight: boolean
  /** Disabled for read-only users — card still opens on double-tap. */
  enabled?: boolean
  /**
   * Fires when the card is picked up (true) and dropped (false).
   *
   * The board lives inside scroll views, and a native ScrollView does NOT stand
   * down just because a Reanimated pan activated — it keeps consuming the same
   * finger, so the board scrolled sideways while the card sat still. The screen
   * uses this to set `scrollEnabled={false}` for the duration of the drag. It
   * fires at pick-up (after the hold, before any movement), so the scroll never
   * gets a chance to start.
   */
  onDragStateChange?: (dragging: boolean) => void
  style?: StyleProp<ViewStyle>
}

/**
 * A kanban card you can hold-and-drag sideways between columns, and double-tap
 * to edit.
 *
 * Press-and-hold (300ms) lifts the card out of the column — it scales up, casts
 * a shadow and follows the finger. Releasing past ±64px commits the move to the
 * adjacent column; anything short of that springs back. Dragging toward a column
 * that does not exist (left of "To Do", right of "Done") rubber-bands to a stop
 * rather than pretending the move is available.
 *
 * The lift is what makes the drag legible: without it, the card slides under
 * the finger with no signal that it has been picked up at all.
 */
export function DraggableCard({
  children,
  onMove,
  onOpen,
  canMoveLeft,
  canMoveRight,
  enabled = true,
  onDragStateChange,
  style,
}: DraggableCardProps) {
  const p = useTheme()

  const translateX = useSharedValue(0)
  const lifted = useSharedValue(0) // 0 → resting, 1 → picked up

  const haptic = (kind: 'lift' | 'commit') => {
    Haptics.impactAsync(
      kind === 'lift'
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light,
    ).catch(() => {})
  }

  const setDragging = (dragging: boolean) => onDragStateChange?.(dragging)

  // activateAfterLongPress is what separates this from a plain swipe: the pan
  // does not begin until the hold completes, so the column's own horizontal
  // ScrollView keeps every ordinary left/right swipe.
  const drag = Gesture.Pan()
    .enabled(enabled)
    .activateAfterLongPress(HOLD_MS)
    .onStart(() => {
      lifted.value = withTiming(1, { duration: motion.fast })
      runOnJS(haptic)('lift')
      runOnJS(setDragging)(true)
    })
    .onUpdate((e) => {
      const blocked = (e.translationX < 0 && !canMoveLeft) || (e.translationX > 0 && !canMoveRight)
      if (!blocked) {
        translateX.value = e.translationX
        return
      }
      // Resist, don't refuse: the card still moves a little so the gesture feels
      // alive, but it visibly runs out of room.
      const overshoot = Math.abs(e.translationX)
      const damped = RUBBER_BAND * (1 - 1 / (overshoot / RUBBER_BAND + 1))
      translateX.value = Math.sign(e.translationX) * damped
    })
    .onEnd((e) => {
      const direction: MoveDirection = e.translationX < 0 ? -1 : 1
      const allowed = direction === -1 ? canMoveLeft : canMoveRight
      const committed = Math.abs(e.translationX) > COMMIT_DISTANCE && allowed

      if (committed) {
        runOnJS(haptic)('commit')
        runOnJS(onMove)(direction)
      }
      // Snap home either way. On a commit the card re-renders into its new
      // column, so animating it off-screen first would just make the move
      // feel slower than it is.
      translateX.value = withSpring(0, { damping: 20, stiffness: 220 })
      lifted.value = withTiming(0, { duration: motion.fast })
    })
    // onEnd does not run if the gesture is cancelled (a call comes in, the
    // finger leaves the screen). Without this the board would stay frozen.
    .onFinalize(() => {
      runOnJS(setDragging)(false)
    })

  const open = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(260)
    .onEnd((_e, success) => {
      if (success) runOnJS(onOpen)()
    })

  // Race, not Simultaneous: a double-tap must never also start a drag.
  const gesture = Gesture.Race(drag, open)

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { scale: interpolate(lifted.value, [0, 1], [1, 1.04]) },
    ],
    // Elevation/shadow ramp in together so the card reads as physically raised.
    shadowOpacity: interpolate(lifted.value, [0, 1], [0, 0.35]),
    shadowRadius: interpolate(lifted.value, [0, 1], [0, 16]),
    elevation: interpolate(lifted.value, [0, 1], [0, 12]),
    zIndex: lifted.value > 0 ? 10 : 0,
  }))

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.card,
          {
            borderRadius: radius.lg,
            // Android derives the elevation shadow from the view's OUTLINE, and
            // a transparent view has none — it fell back to a hard dark
            // rectangle behind the card. An opaque background matching the card
            // (and the same radius) gives the shadow a rounded shape to follow.
            backgroundColor: p.card,
          },
          animatedStyle,
          style,
        ]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  card: {
    // Neutral shadow. A brand-tinted one read as a coloured glow bleeding out
    // from under the card rather than as depth.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
  },
})
