// The Bitrails brand mark: an abstract "B" letterform (terracotta) with a dot accent (cyan).
//
// Source: the provided `bitrails.dev-dot.svg` (a single <path> at fill rgb(190,0,255)). The
// original path draws both the letter subpaths and the dot subpath in one element, so they
// couldn't be colored independently. Here the path is split into two <path> elements at the
// final `M` subpath boundary (the dot is the last subpath, a circle centered at ~1380,1959 in
// the source's absolute coordinates), so the letter and dot can carry separate fills.
//
// The wrapper <g> preserves the source's `transform="matrix(1,0,0,1,-946.83,-1409.88)"` which
// maps the absolute-coordinate path data into the viewBox `0 0 492 607`. ViewBox and path data
// are otherwise verbatim from the source SVG — only the fill colors and the path split changed.
//
// Colors:
//   - letter (terracotta): #C2563F  (a warm, earthy terracotta — reads well on light + dark)
//   - dot (cyan):          #06B6D4  (Tailwind cyan-500; vivid accent against the terracotta)
//
// Used by:
//   - BitrailsLogo  (login page + dashboard: mark + "Bitrails" wordmark)
//   - BitrailsIcon  (collapsed sidebar: mark only, no wordmark)

import type { CSSProperties } from 'react'

export type BitrailsMarkProps = {
  /** Inline style applied to the <svg> (width/height/display). */
  style?: CSSProperties
  /** Optional className for the <svg>. */
  className?: string
}

// Absolute-coordinate path data, verbatim from bitrails.dev-dot.svg. The wrapper <g> below applies
// the source's translate so these coords render inside the 0..492 / 0..607 viewBox.
const LETTER_PATH =
  'M1293.547,1995.263C1265.088,2008.136 1233.747,2015.742 1200.768,2016.835L1200.768,1864.751C1245.952,1860.798 1282.356,1824.754 1286.309,1779.57L1438.033,1779.57C1436.94,1812.549 1429.334,1843.89 1416.461,1872.349C1405.291,1867.657 1393.025,1865.063 1380.158,1865.063C1328.335,1865.063 1286.261,1907.137 1286.261,1958.961C1286.261,1971.827 1288.854,1984.093 1293.547,1995.263ZM946.831,1409.982C947.804,1409.918 948.818,1409.885 949.872,1409.885C1027.21,1409.885 1090.849,1469.012 1098.018,1544.487C1098.463,1549.167 1098.691,1558.71 1098.691,1558.71L1098.691,1771.302C1098.691,1820.291 1136.323,1860.56 1184.232,1864.751L1184.232,2016.835C1052.465,2012.468 946.831,1904.124 946.831,1771.302L946.831,1409.982ZM1285.948,1763.016C1281.748,1715.116 1241.483,1677.493 1192.5,1677.493C1160.462,1677.493 1132.153,1693.589 1115.226,1718.128L1115.226,1538.052C1139.528,1529.995 1165.509,1525.633 1192.5,1525.633C1325.322,1525.633 1433.666,1631.267 1438.033,1763.034L1285.948,1763.016ZM946.831,1409.982C946.83,1409.982 946.83,1409.981 946.83,1409.981C946.829,1409.958 946.831,1409.901 946.831,1409.885'

const DOT_PATH =
  'M1380.158,1901.087C1412.1,1901.087 1438.033,1927.019 1438.033,1958.961C1438.033,1990.902 1412.1,2016.835 1380.158,2016.835C1348.217,2016.835 1322.284,1990.902 1322.284,1958.961C1322.284,1927.019 1348.217,1901.087 1380.158,1901.087Z'

export const BITRAILS_TERRACOTTA = '#C2563F'
export const BITRAILS_CYAN = '#06B6D4'

/**
 * The Bitrails mark as inline SVG. Renders only the mark (letter + dot) — no wordmark.
 * The Logo and Icon components compose this; it is not registered directly with Payload.
 */
export function BitrailsMark({ style, className }: BitrailsMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 492 607"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
      aria-hidden="true"
    >
      <g transform="matrix(1,0,0,1,-946.830039,-1409.884826)">
        {/* Letter "B" — terracotta. Composed of the first four subpaths of the source path. */}
        <path d={LETTER_PATH} style={{ fill: BITRAILS_TERRACOTTA }} />
        {/* Dot accent — cyan. The final subpath of the source path (a circle at bottom-right). */}
        <path d={DOT_PATH} style={{ fill: BITRAILS_CYAN }} />
      </g>
    </svg>
  )
}
