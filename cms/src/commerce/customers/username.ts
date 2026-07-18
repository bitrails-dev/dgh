// Server-only username derivation for tenant-aware Payload customer auth (plan §3.6).
// `<immutable tenant numeric ID>:<normalized email>` — globally unique (Payload requires a unique
// username) and tenant-scoped by construction. The browser never sees it; it is derived server-side
// and written via the collection's beforeChange hook.
import { normalizeEmail } from './auth'

export function normalizeEmailForUsername(email: string): string | null {
  return normalizeEmail(email)
}

export function deriveCustomerUsername(
  tenantId: number | string | { id?: number | string } | null | undefined,
  email: string,
): string | null {
  if (tenantId == null) return null
  const tid =
    typeof tenantId === 'object' && tenantId !== null
      ? tenantId.id
      : (tenantId as number | string)
  if (tid == null) return null
  const normalized = normalizeEmailForUsername(email)
  if (!normalized) return null
  return `${tid}:${normalized}`
}
