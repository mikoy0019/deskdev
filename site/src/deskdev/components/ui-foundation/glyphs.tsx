import {
  BellIcon, BriefcaseIcon, CalendarBlankIcon, CheckSquareIcon, type Icon, type IconProps, LockIcon,
  MagnifyingGlassIcon, TableIcon, UsersThreeIcon, VideoCameraIcon,
} from '@phosphor-icons/react'

/**
 * The larger empty-state / feature marks. They used to be a hand-drawn
 * duotone SVG set; they are Phosphor now, the one icon family, at the one
 * weight (regular) — the same shapes the sidebar uses for each area, so an
 * empty Tasks view shows the Tasks icon, only bigger.
 */

export type GlyphName =
  | 'clients'
  | 'projects'
  | 'tasks'
  | 'calendar'
  | 'crm'
  | 'meetings'
  | 'notifications'
  | 'vault'
  | 'search-empty'

const GLYPHS: Record<GlyphName, Icon> = {
  clients: UsersThreeIcon,
  projects: BriefcaseIcon,
  tasks: CheckSquareIcon,
  calendar: CalendarBlankIcon,
  crm: TableIcon,
  meetings: VideoCameraIcon,
  notifications: BellIcon,
  vault: LockIcon,
  'search-empty': MagnifyingGlassIcon,
}

export type GlyphProps = Omit<IconProps, 'name' | 'weight'> & {
  name: GlyphName
}

/** A decorative mark (aria-hidden): the visible title next to it names the state. */
export function Glyph({ name, size = 24, ...rest }: GlyphProps) {
  const Mark = GLYPHS[name]
  return <Mark size={size} aria-hidden {...rest} />
}

export const GLYPH_NAMES = Object.keys(GLYPHS) as GlyphName[]
