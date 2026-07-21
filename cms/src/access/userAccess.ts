import { APIError } from 'payload'
import { getTenantFromCookie } from '@payloadcms/plugin-multi-tenant/utilities'
import type {
  CollectionBeforeChangeHook,
  CollectionBeforeDeleteHook,
  FieldAccess,
} from 'payload'

export type UserRole = 'super-admin' | 'admin' | 'editor'

type Relation = number | string | { id: number | string }
type TenantRow = { tenant?: Relation | null; commercePermissions?: string[] | null }
export type UserLike = {
  id?: number | string
  roles?: UserRole[] | null
  tenants?: TenantRow[] | null
}

const forbidden = (message: string): never => {
  throw new APIError(message, 403, null, true)
}

const relationID = (relation: Relation | null | undefined): string | null => {
  if (relation === null || relation === undefined) return null
  if (typeof relation === 'object') return String(relation.id)
  return String(relation)
}

// Role-based default `commercePermissions` for a User→Tenant assignment row, applied by
// `enforceUserScope` when the row's set is UNSET (undefined). Matches the contract documented in
// cms/src/commerce/permissions.ts: tenant-admin → all; editor → catalog.manage; super-admin needs
// none stored (the reader short-circuits to ALL for super-admin). An explicit `[]` is preserved —
// it's a deliberate "no commerce" grant by an operator, not a default candidate.
//
// The permission strings are inlined here (not imported from commerce/permissions.ts) to avoid a
// module-init cycle: commerce/permissions.ts imports `isSuperAdmin` + `UserLike` from THIS module,
// so importing ALL_COMMERCE_PERMISSIONS back from it creates a TDZ ReferenceError when this module
// loads first. The canonical list lives in commerce/permissions.ts; this is a deliberately
// duplicated constant. A test (see commerce-permissions.test.ts 'after the stamping hook runs…')
// pins that the two stay in sync by asserting the stamped result reads back as the full set.
const ALL_COMMERCE_PERMISSIONS = [
  'catalog.manage',
  'inventory.manage',
  'orders.read',
  'orders.manage',
  'payments.refund',
  'fulfillment.manage',
  'customers.manage',
  'promotions.manage',
  'reports.read',
  'settings.manage',
] as const

const EDITOR_DEFAULT_COMMERCE_PERMISSIONS = ['catalog.manage'] as const

const defaultCommercePermissionsFor = (roles: UserRole[] | null | undefined): readonly string[] => {
  if (!roles || roles.length === 0) return []
  // A user carrying 'super-admin' is granted ALL permissions at read time by `effectivePermissions`
  // (commerce/permissions.ts) regardless of what's stored, so leave the row unset. Otherwise take
  // the most permissive default among the user's roles (admin > editor > none).
  if (roles.includes('super-admin')) return []
  if (roles.includes('admin')) return ALL_COMMERCE_PERMISSIONS
  if (roles.includes('editor')) return EDITOR_DEFAULT_COMMERCE_PERMISSIONS
  return []
}

// Stamp each tenant-assignment row's `commercePermissions` with the role-based default when unset.
// Mutates `data.tenants` in place. Called from `enforceUserScope` on every successful path so the
// default applies to both create and update (an update that adds a new tenant row gets the default
// on that row; an existing row with an explicit value is left alone).
const normalizeTenantCommercePermissions = (
  data: { roles?: UserRole[] | null; tenants?: TenantRow[] | null },
  roles: UserRole[] | null | undefined,
): void => {
  if (!data.tenants) return
  const defaulted = defaultCommercePermissionsFor(roles)
  if (defaulted.length === 0) return // super-admin or unknown role: leave rows untouched
  for (const row of data.tenants) {
    if (row && row.commercePermissions === undefined) {
      row.commercePermissions = [...defaulted]
    }
  }
}


export const getUserTenantIDs = (user: UserLike | null | undefined): string[] =>
  (user?.tenants ?? [])
    .map((row) => relationID(row?.tenant))
    .filter((id): id is string => Boolean(id))

export const hasRole = (user: UserLike | null | undefined, role: UserRole): boolean =>
  Boolean(user?.roles?.includes(role))

export const isSuperAdmin = (user: UserLike | null | undefined): boolean =>
  hasRole(user, 'super-admin')

export const isTenantAdmin = (user: UserLike | null | undefined): boolean =>
  hasRole(user, 'admin')

export const isUserManager = (user: UserLike | null | undefined): boolean =>
  isSuperAdmin(user) || isTenantAdmin(user)

export const authenticatedFieldAccess: FieldAccess = ({ req }) => Boolean(req.user)

export const manageUserScopeFieldAccess: FieldAccess = ({ req }) =>
  isUserManager(req.user as UserLike | null)

export const enforceUserScope: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  // Trusted Local API scripts use overrideAccess and may not carry a user. HTTP requests are
  // rejected by collection access before reaching this hook.
  const actor = req.user as UserLike | null
  if (!actor) return data

  const original = originalDoc as UserLike | undefined
  const requestedRoles = (data.roles ?? original?.roles ?? ['editor']) as UserRole[]
  const requestedTenantRows = (data.tenants ?? original?.tenants ?? []) as TenantRow[]
  const requestedTenantIDs = requestedTenantRows
    .map((row) => relationID(row?.tenant))
    .filter((id): id is string => Boolean(id))

  if (isSuperAdmin(actor)) {
    if (!requestedRoles.includes('super-admin') && requestedTenantIDs.length === 0) {
      forbidden('Tenant admins and editors must be assigned to at least one tenant.')
    }
    normalizeTenantCommercePermissions(data, requestedRoles)
    return data
  }

  const actorID = actor.id === undefined ? null : String(actor.id)
  const targetID = original?.id === undefined ? null : String(original.id)

  if (!isTenantAdmin(actor)) {
    if (operation === 'create' || actorID !== targetID) {
      forbidden('Editors can only update their own account.')
    }
    if (data.roles !== undefined || data.tenants !== undefined) {
      forbidden('Editors cannot change roles or tenant assignments.')
    }
    // data.tenants is undefined here (the lock above forbids it), so normalization no-ops. Kept for
    // symmetry with the other return paths in case the lock is ever relaxed.
    normalizeTenantCommercePermissions(data, requestedRoles)
    return data
  }

  if (original?.roles?.includes('super-admin')) {
    forbidden('Tenant admins cannot modify a super-admin account.')
  }
  if (requestedRoles.includes('super-admin')) {
    forbidden('Only a super-admin can grant the super-admin role.')
  }
  if (operation === 'update' && actorID === targetID && (data.roles !== undefined || data.tenants !== undefined)) {
    forbidden('Tenant admins cannot change their own role or tenant assignments.')
  }

  const actorTenantIDs = new Set(getUserTenantIDs(actor))
  if (actorTenantIDs.size === 0) {
    forbidden('Tenant admins must be assigned to at least one tenant.')
  }

  const originalTenantIDs = getUserTenantIDs(original)
  if (operation === 'update' && originalTenantIDs.some((tenantID) => !actorTenantIDs.has(tenantID))) {
    forbidden('Tenant admins cannot modify users who are also assigned to other tenants.')
  }

  if (operation === 'create' && data.tenants === undefined) {
    const selectedTenant = getTenantFromCookie(req.headers, req.payload.db.defaultIDType)
    const selectedTenantID = relationID(selectedTenant)
    if (!selectedTenantID || !actorTenantIDs.has(selectedTenantID)) {
      forbidden('Select one of your tenants before creating a user, or assign a tenant explicitly.')
    }
    data.tenants = [{ tenant: selectedTenant }]
    normalizeTenantCommercePermissions(data, requestedRoles)
    return data
  }

  if (requestedTenantIDs.length === 0) {
    forbidden('Tenant admins and editors must be assigned to at least one tenant.')
  }
  if (requestedTenantIDs.some((tenantID) => !actorTenantIDs.has(tenantID))) {
    forbidden('Tenant admins can only assign users to their own tenants.')
  }

  normalizeTenantCommercePermissions(data, requestedRoles)
  return data
}

export const enforceUserDeleteScope: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const actor = req.user as UserLike | null
  if (!actor || isSuperAdmin(actor)) return
  if (!isTenantAdmin(actor)) forbidden('Only tenant admins and super-admins can delete users.')
  if (String(actor.id) === String(id)) forbidden('Tenant admins cannot delete their own account.')

  const target = await req.payload.findByID({
    collection: 'users',
    id,
    depth: 0,
    overrideAccess: true,
    req,
  }) as UserLike

  if (isSuperAdmin(target)) forbidden('Tenant admins cannot delete a super-admin account.')

  const actorTenantIDs = new Set(getUserTenantIDs(actor))
  const targetTenantIDs = getUserTenantIDs(target)
  if (targetTenantIDs.length === 0 || targetTenantIDs.some((tenantID) => !actorTenantIDs.has(tenantID))) {
    forbidden('Tenant admins can only delete users assigned exclusively to their own tenants.')
  }
}
