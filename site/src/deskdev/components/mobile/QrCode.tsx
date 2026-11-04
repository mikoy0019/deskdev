import { useMemo } from 'react'
import { encode } from 'uqr'
import { classNames } from '../../lib/format'

// Quiet zone in modules. The spec asks for 4; the white card supplies it, so
// the code scans the same on a dark page as on a light one.
const QUIET = 4

/** One SVG path for every dark module, merging horizontal runs into a rect each. */
function modulesPath(data: boolean[][]): string {
  let d = ''
  data.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (!row[x]) {
        x += 1
        continue
      }
      const start = x
      while (x < row.length && row[x]) x += 1
      d += `M${start} ${y}h${x - start}v1h${start - x}z`
    }
  })
  return d
}

/**
 * A QR code as inline SVG: crisp at any size, dark modules on a white rounded
 * card (QR readers need dark-on-light, so the colors don't follow the theme).
 */
export default function QrCode({
  value,
  size = 168,
  className,
}: {
  value: string
  /** Rendered width and height in CSS px, quiet zone included. */
  size?: number
  className?: string
}) {
  const qr = useMemo(() => {
    const { size: modules, data } = encode(value, { ecc: 'M', border: 0 })
    return { modules, path: modulesPath(data) }
  }, [value])

  const box = qr.modules + QUIET * 2
  const label = `QR code for ${value}`

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-QUIET} ${-QUIET} ${box} ${box}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={classNames('block shrink-0', className)}
    >
      <title>{label}</title>
      {/* Fixed white and near-black, not tokens: scannability over theming. */}
      <rect x={-QUIET} y={-QUIET} width={box} height={box} rx={2.5} fill="#ffffff" />
      <path d={qr.path} fill="#0f172a" />
    </svg>
  )
}
