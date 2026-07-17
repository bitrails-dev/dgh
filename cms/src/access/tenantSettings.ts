import { APIError } from 'payload'
import type { CollectionBeforeChangeHook } from 'payload'
import { isSuperAdmin, isTenantAdmin } from './userAccess'
import type { UserLike } from './userAccess'

// Setting groups a platform super-admin can grant a tenant administrator. This entitlement is
// separate from `features` (which gates public/content modules + their collections): it governs
// only which tenant setting groups a non-super admin may edit for their own tenant.
export type TenantSettingGroup = 'general' | 'branding' | 'hero' | 'contact' | 'socialPublishing'

export const TENANT_SETTING_GROUPS = [
  // `general` controls the tenant display name (`name`) only.
  { value: 'general', label: { ar: 'البيانات العامة', en: 'General' } },
  { value: 'branding', label: { ar: 'الهوية', en: 'Branding' } },
  { value: 'hero', label: { ar: 'إحصائيات الواجهة', en: 'Hero stats' } },
  { value: 'contact', label: { ar: 'معلومات التواصل', en: 'Contact' } },
  // `socialPublishing` governs the tenant's social auto-publish settings (master enable, default
  // Article auto-publish, and per-platform inclusion). A platform operator may withhold it.
  { value: 'socialPublishing', label: { ar: 'النشر التلقائي', en: 'Social publishing' } },
] satisfies Array<{ value: TenantSettingGroup; label: { ar: string; en: string } }>

// Newly created tenants default to every group unless a super-admin explicitly restricts them.
export const ALL_TENANT_SETTING_GROUPS: TenantSettingGroup[] = TENANT_SETTING_GROUPS.map(
  (group) => group.value,
)

// Each entitlement group maps to the tenant fields it governs.
const SETTING_GROUP_FIELDS: Record<TenantSettingGroup, readonly string[]> = {
  general: ['name'],
  branding: ['branding'],
  hero: ['hero'],
  contact: ['contact'],
  socialPublishing: ['socialPublishing'],
}

// Structural/platform fields a non-super admin may never change.
export const TENANT_PLATFORM_FIELDS = [
  'slug',
  'type',
  'domains',
  'features',
  'settingsEntitlement',
] as const

const forbidden = (message: string): never => {
  throw new APIError(message, 403, null, true)
}

const hasOwn = (value: unknown, key: PropertyKey): boolean =>
  typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, key)

// Structural deep equality so localized + nested group data compares correctly even when a forged
// payload re-submits a value for a group the admin must not touch. Equal values are treated as
// no-ops so partial updates never erase untouched settings.
export const settingValuesEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((entry, index) => settingValuesEqual(entry, b[index]))
  }
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  return aKeys.length === bKeys.length && aKeys.every((key) => settingValuesEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}

// Used by both the admin field conditions (convenience) and the server hook (boundary).
export const entitlementIncludes = (
  entitlement: unknown,
  group: TenantSettingGroup,
): boolean => Array.isArray(entitlement) && entitlement.includes(group)

// Server-side enforcement. Admin field/group conditions are convenience only; this hook is the
// security boundary and runs for every update path (REST, GraphQL, Local API with access enabled,
// and the admin form). Throwing aborts the operation, so the stored value is never modified when an
// entitlement is removed — re-enabling restores the previous value.
export const enforceTenantSettingsEntitlement: CollectionBeforeChangeHook = ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  const actor = req.user as UserLike | null
  // Trusted Local API scripts (overrideAccess, no user) and super-admins bypass entitlement checks.
  if (!actor || isSuperAdmin(actor)) return data
  // Tenants are created by super-admins only (collection access); nothing to enforce on create.
  if (operation !== 'update' || !originalDoc) return data
  // Defense in depth for Local API calls that override collection access while supplying a user.
  if (!isTenantAdmin(actor)) forbidden('Only tenant admins and super-admins can edit entity settings.')

  const stored = originalDoc as Record<string, unknown>
  const incoming = data as Record<string, unknown>

  // Platform-controlled fields: a non-super user may never change them, regardless of entitlement.
  for (const field of TENANT_PLATFORM_FIELDS) {
    if (hasOwn(incoming, field) && !settingValuesEqual(incoming[field], stored[field])) {
      forbidden(`Only platform super-admins can change the "${field}" field.`)
    }
  }

  // Setting groups: only groups present in this tenant's stored entitlement may change. A missing
  // or empty entitlement fails closed — the admin can edit none of the setting groups.
  for (const group of ALL_TENANT_SETTING_GROUPS) {
    if (entitlementIncludes(stored.settingsEntitlement, group)) continue
    for (const field of SETTING_GROUP_FIELDS[group]) {
      if (hasOwn(incoming, field) && !settingValuesEqual(incoming[field], stored[field])) {
        forbidden(`This entity is not entitled to edit "${group}" settings.`)
      }
    }
  }

  return data
}
