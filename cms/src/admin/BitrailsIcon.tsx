// Bitrails icon for the Payload admin sidebar/nav: the Bitrails mark (terracotta B + cyan dot),
// without the wordmark. Registered as `admin.components.graphics.Icon` in payload.config.ts,
// replacing the default PayloadIcon in the collapsed sidebar and nav header.
//
// Unlike Payload's default Icon (which accepts a `fill` prop and recolors the whole mark to the
// theme elevation), the Bitrails mark is intentionally two-color (terracotta letter + cyan dot),
// so the `fill` prop is accepted for interface compatibility but ignored — the mark always renders
// in its brand colors. This matches the decision to keep the dot visible at all sidebar sizes.

import { BitrailsMark } from './BitrailsMark'

export default function BitrailsIcon() {
  return <BitrailsMark style={{ height: '1.5rem', width: '1.2rem' }} />
}
