// Commerce staff permission matrix. Each User-to-Tenant assignment carries a `commercePermissions`
// set (added via the multi-tenant plugin's tenantsArrayField.rowFields). These keys gate commerce
// admin actions and sensitive Local API writes for the currently selected Tenant.
//
// Rules (enforced by callers):
//   - super-admin implicitly holds every permission across all tenants;
//   - a tenant admin's default preset receives all permissions for that tenant;
//   - an editor's default preset receives only `catalog.manage`;
//   - sensitive checks reload the user's CURRENT assignment (reloadEffectivePermissions) rather
//     than trusting potentially-stale JWT claims.
//
// The catalogue doubles as the labelled `select` options for the rowFields field.

import { isSuperAdmin } from '../access/userAccess'
import type { UserLike } from '../access/userAccess'

export type CommercePermission =
  | 'catalog.manage'
  | 'inventory.manage'
  | 'orders.read'
  | 'orders.manage'
  | 'payments.refund'
  | 'fulfillment.manage'
  | 'customers.manage'
  | 'promotions.manage'
  | 'reports.read'
  | 'settings.manage'

export const COMMERCE_PERMISSIONS: ReadonlyArray<{
  value: CommercePermission
  label: { ar: string; en: string }
}> = [
  { value: 'catalog.manage', label: { ar: 'إدارة الكتالوج', en: 'Manage catalog' } },
  { value: 'inventory.manage', label: { ar: 'إدارة المخزون', en: 'Manage inventory' } },
  { value: 'orders.read', label: { ar: 'عرض الطلبات', en: 'View orders' } },
  { value: 'orders.manage', label: { ar: 'إدارة الطلبات', en: 'Manage orders' } },
  { value: 'payments.refund', label: { ar: 'استرداد المدفوعات', en: 'Refund payments' } },
  { value: 'fulfillment.manage', label: { ar: 'إدارة الشحن', en: 'Manage fulfillment' } },
  { value: 'customers.manage', label: { ar: 'إدارة العملاء', en: 'Manage customers' } },
  { value: 'promotions.manage', label: { ar: 'إدارة العروض', en: 'Manage promotions' } },
  { value: 'reports.read', label: { ar: 'عرض التقارير', en: 'View reports' } },
  { value: 'settings.manage', label: { ar: 'إدارة الإعدادات', en: 'Manage settings' } },
]

export const ALL_COMMERCE_PERMISSIONS: readonly CommercePermission[] = COMMERCE_PERMISSIONS.map(
  (p) => p.value,
)

// Matches UserLike's TenantRow.tenant shape so a CommerceAssignmentRow is assignable to TenantRow
// (lets typed fixtures flow into a CommerceUser without casts), while relationID still tolerates the
// broader runtime shapes Payload can hand us.
export type CommerceAssignmentRow = {
  tenant?: number | string | { id: number | string } | null
  commercePermissions?: string[] | null
}

type Relation = CommerceAssignmentRow['tenant'] | { id?: number | string } | undefined

const relationID = (relation: Relation): string | null => {
  if (relation === null || relation === undefined) return null
  if (typeof relation === 'object') {
    const id = relation?.id
    return typeof id === 'number' || typeof id === 'string' ? String(id) : null
  }
  return String(relation)
}
// A user carries `roles` + `tenants` (UserLike); each tenant-assignment row additionally holds a
// `commercePermissions` set at runtime (added via tenantsArrayField.rowFields), read here by cast.
export type CommerceUser = UserLike

// Pure resolution from an in-memory user. Super-admin → all permissions. Otherwise only the
// permissions attached to the matching tenant-assignment row. No matching row → empty set.
export function effectivePermissions(
  user: CommerceUser | null | undefined,
  tenantId: number | string,
): Set<CommercePermission> {
  if (isSuperAdmin(user)) return new Set(ALL_COMMERCE_PERMISSIONS)
  const wanted = String(tenantId)
  const row = (user?.tenants ?? []).find((r) => relationID(r.tenant) === wanted)
  const granted = ((row as CommerceAssignmentRow | undefined)?.commercePermissions ?? []) as CommercePermission[]
  return new Set(granted.filter((p) => (ALL_COMMERCE_PERMISSIONS as readonly string[]).includes(p)))
}

export function hasPermission(
  granted: Set<CommercePermission>,
  permission: CommercePermission,
): boolean {
  return granted.has(permission)
}

// Reload the user's CURRENT assignment before a sensitive check, so a revoked permission takes
// effect even if the acting request still carries an older JWT. Returns the effective set for the
// given tenant. Callers must already be authenticated.
export async function reloadEffectivePermissions(
  payload: { findByID: (args: Record<string, unknown>) => Promise<unknown> },
  req: unknown,
  userId: number | string,
  tenantId: number | string,
): Promise<Set<CommercePermission>> {
  const user = (await payload.findByID({
    collection: 'users',
    id: userId,
    depth: 2,
    overrideAccess: true,
    req,
  } as Record<string, unknown>)) as CommerceUser
  return effectivePermissions(user, tenantId)
}
