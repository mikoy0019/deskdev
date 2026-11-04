/**
 * Shared visual-language primitives. Stage-2 screens import from here.
 *
 *   import { EmptyState, SkeletonList, useDensity, Glyph } from '@/components/ui-foundation'
 */
export { default as CommandPalette, KbdHint, OPEN_EVENT } from './CommandPalette'
export { DensityProvider, DensityToggle, useDensity, type Density } from './DensityProvider'
export { Glyph, GLYPH_NAMES, type GlyphName } from './glyphs'
export {
  SkeletonLine,
  SkeletonBlock,
  SkeletonCard,
  SkeletonRow,
  SkeletonList,
  SkeletonBoard,
} from './Skeleton'
export { default as EmptyState } from '../EmptyState'
