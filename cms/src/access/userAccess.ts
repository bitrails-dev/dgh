import { APIError } from 'payload'
import { getTenantFromCookie } from '@payloadcms/plugin-multi-tenant/utilities'
import type {
  CollectionBeforeChangeHook,
  CollectionBeforeDeleteHook,
  FieldAccess,
} from 'payload'

export type UserRole = 'super-admin' | 'admin' | 'editor'

type Relation = number | string | { id: number | string }
type TenantRow = { tenant?: Relation | null }
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
    return data
  }

  if (requestedTenantIDs.length === 0) {
    forbidden('Tenant admins and editors must be assigned to at least one tenant.')
  }
  if (requestedTenantIDs.some((tenantID) => !actorTenantIDs.has(tenantID))) {
    forbidden('Tenant admins can only assign users to their own tenants.')
  }

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
