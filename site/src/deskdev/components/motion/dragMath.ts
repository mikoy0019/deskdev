/**
 * Pure gesture math for drag-to-dismiss (sheets, drawers). No DOM, no React —
 * useDragToDismiss feeds it pointer samples. Distances are in "dismiss units":
 * px along the axis, positive toward the edge the surface leaves through.
 */

/** A pointer sample: position along the dismiss axis (px) at time t (ms). */
export interface DragSample {
  d: number
  t: number
}

/** Emil: a flick faster than this (px/ms) dismisses whatever the distance. */
export const DISMISS_VELOCITY = 0.11
/** Apple: movement before a drag commits to a direction (px). */
export const DRAG_SLOP = 10
/** Recent motion back toward rest faster than this (px/ms) keeps it open. */
export const REVERSE_VELOCITY = 0.05
/** How far back the release-velocity window reaches (ms). */
export const VELOCITY_WINDOW = 100

/**
 * Apple's rubber band: past a bound, the surface follows less the further
 * the finger goes — friction, never a wall. `overshoot` is how far past the
 * bound (px, >= 0), `dimension` the surface's size along the axis.
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (overshoot <= 0 || dimension <= 0) return 0
  return (overshoot * dimension * constant) / (dimension + constant * overshoot)
}

/**
 * Where the surface sits for a raw drag distance: 1:1 toward the dismiss
 * edge, rubber-banded the other way (it is already fully open).
 */
export function dragOffset(raw: number, size: number): number {
  return raw >= 0 ? raw : -rubberband(-raw, size)
}

/** Distance that dismisses on its own: a quarter of the surface, 56–200px. */
export function dismissDistance(size: number): number {
  return Math.min(200, Math.max(56, size * 0.25))
}

/**
 * Velocity at release (px/ms) from the samples in the last VELOCITY_WINDOW.
 * Positive = moving toward the dismiss edge. 0 with fewer than two samples.
 */
export function releaseVelocity(samples: readonly DragSample[], now?: number): number {
  if (samples.length < 2) return 0
  const last = samples[samples.length - 1]
  const end = now ?? last.t
  let first = last
  for (let i = samples.length - 2; i >= 0; i--) {
    if (end - samples[i].t > VELOCITY_WINDOW) break
    first = samples[i]
  }
  const dt = last.t - first.t
  return dt > 0 ? (last.d - first.d) / dt : 0
}

/** Keep only the samples a velocity read can use (bounded memory). */
export function pushSample(samples: DragSample[], sample: DragSample): DragSample[] {
  samples.push(sample)
  while (samples.length > 2 && sample.t - samples[0].t > VELOCITY_WINDOW * 2) samples.shift()
  return samples
}

export interface DismissInput {
  /** Raw drag distance at release (px; negative = dragged against the edge). */
  distance: number
  /** Time from pointer-down to release (ms). */
  elapsed: number
  /** releaseVelocity() at release (px/ms). */
  velocity: number
  /** Surface size along the axis (px). */
  size: number
}

/**
 * Commit or return? Apple: decide by the velocity's sign — a finger moving
 * back toward rest keeps the surface open however far it travelled. Emil:
 * otherwise a flick (average speed over the whole drag > 0.11 px/ms)
 * dismisses regardless of distance, and so does passing the distance mark.
 */
export function shouldDismiss({ distance, elapsed, velocity, size }: DismissInput): boolean {
  if (distance <= 0) return false
  if (velocity < -REVERSE_VELOCITY) return false
  if (elapsed > 0 && distance / elapsed > DISMISS_VELOCITY) return true
  if (velocity > DISMISS_VELOCITY) return true
  return distance >= dismissDistance(size)
}

/**
 * Has the pointer moved far enough to commit, and along which axis?
 * 'drag' = along the dismiss axis, 'cancel' = the cross axis won (let the
 * browser scroll), null = still inside the slop circle.
 */
export function classifyMove(along: number, cross: number): 'drag' | 'cancel' | null {
  if (Math.abs(along) < DRAG_SLOP && Math.abs(cross) < DRAG_SLOP) return null
  return Math.abs(along) >= Math.abs(cross) ? 'drag' : 'cancel'
}
