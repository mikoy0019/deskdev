import { useWindowDimensions, type ViewStyle } from 'react-native'

// Screen-size rules for the whole app, from a 320 px phone to a 13" iPad in
// landscape. Phones are portrait and use the full width; a tablet (shortest
// side ≥ 600, any orientation) keeps reading screens to a comfortable column
// in the middle instead of 1,200 px wide rows, while boards, the calendar and
// tables keep the full width (Screen `wide`).

/** Shortest side from which a device is treated as a tablet (dp). */
export const TABLET_MIN_SIDE = 600

/** The reading column on a tablet: lists, forms, detail screens (dp). */
export const READING_MAX_WIDTH = 760

/** Sheets and form modals on a tablet (dp). */
export const SHEET_MAX_WIDTH = 640

/** The floating tab pill never stretches past this (dp). */
export const TAB_BAR_MAX_WIDTH = 520

export interface Responsive {
  width: number
  height: number
  /** Shortest side ≥ TABLET_MIN_SIDE. */
  isTablet: boolean
  /** Narrower than a typical phone (iPhone SE 1st gen, small Androids). */
  isCompact: boolean
  isLandscape: boolean
  /** Max width for reading screens, or undefined on phones (full width). */
  readingMaxWidth: number | undefined
}

/** Pure, for tests and non-hook callers. */
export function responsiveFor(width: number, height: number): Responsive {
  const isTablet = Math.min(width, height) >= TABLET_MIN_SIDE
  return {
    width,
    height,
    isTablet,
    isCompact: width < 360,
    isLandscape: width > height,
    readingMaxWidth: isTablet ? READING_MAX_WIDTH : undefined,
  }
}

/** Follows rotation, split screen and window resizes (iPad, foldables). */
export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions()
  return responsiveFor(width, height)
}

/** Centred column of at most `maxWidth`, or nothing when there's no cap. */
export function centeredColumn(maxWidth: number | undefined): ViewStyle | undefined {
  return maxWidth ? { width: '100%', maxWidth, alignSelf: 'center' } : undefined
}

/**
 * How many grid columns of at least `minItem` fit in `width` with `gap`
 * between them, capped at `max`.
 */
export function gridColumns(width: number, minItem: number, gap: number, max = 4): number {
  return Math.max(1, Math.min(max, Math.floor((width + gap) / (minItem + gap))))
}
