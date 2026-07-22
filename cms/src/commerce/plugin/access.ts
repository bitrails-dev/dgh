// Access functions for the ecommerce plugin.
//
// Plan §3.2 + Wave-A correction #4. Implements the seven required commerce access functions and
// rolls them into a single `commercePluginAccess` object the integration owner wires into
// `ecommercePlugin({ access: commercePluginAccess, ... })` at B4.
//
// Staff-admin gates (`adminOnlyFieldAccess`, `adminOrPublishedStatus`, `isAdmin`) are driven by a
// DERIVED `manageCommerce` roll-up: a user is a "commerce admin" when the existing
// `effectivePermissions` resolver (cms/src/commerce/permissions.ts) returns ANY commerce-manage
// capability for the current tenant, OR when the user is a super-admin (effectivePermissions itself
// returns ALL permissions for super-admin via `isSuperAdmin`). The CommercePermission enum and
// permissions.ts are NOT modified.
//
// The current tenant is derived from the multi-tenant plugin's tenant cookie via
// `getTenantFromCookie`. The multi-tenant plugin intersects these results with tenant access at its
// own layer — we do not use `overrideAccess: true` from these functions.

import type { Access, FieldAccess, PayloadRequest } from 'payload'
import { getTenantFromCookie } from '@payloadcms/plugin-multi-tenant/utilities'
// `AccessConfig` is not directly re-exported by the plugin's type surface, so we derive it from the
// top-level plugin config (`EcommercePluginConfig['access']`).
import type { EcommercePluginConfig } from '@payloadcms/plugin-ecommerce/types'

import { isSuperAdmin, type UserLike } from '../../access/userAccess'
import {
  effectivePermissions,
  type CommercePermission,
  type CommerceUser,
} from '../permissions'

type AccessConfig = EcommercePluginConfig['access']

// CommercePermission ends in `.manage` for the seven staff management capabilities. Any of these
// rolls up into the "commerce admin" grant. `payments.refund`, `orders.read` and `reports.read` are
// NOT management grants and do not elevate a non-admin to commerce-admin.
const MANAGE_COMMERCE_PERMISSIONS: readonly CommercePermission[] = [
  'catalog.manage',
  'inventory.manage',
  'orders.manage',
  'fulfillment.manage',
  'customers.manage',
  'promotions.manage',
  'settings.manage',
]

/**
 * Pure commerce-admin check for a (user, tenantId) pair. Exported for unit tests so the tenant path
 * can be exercised without depending on cookie/req plumbing.
 *
 *  - null/undefined user → false
 *  - super-admin → true (effectivePermissions returns ALL permissions; `isSuperAdmin` short-circuits)
 *  - null tenantId → false (cannot resolve the user's assignment row)
 *  - otherwise → true iff the resolved permission set contains any commerce-manage capability
 */
export function isCommerceAdminForTenant(
  user: unknown,
  tenantId: number | string | null,
): boolean {
  if (!user) return false
  if (isSuperAdmin(user as UserLike)) return true
  if (tenantId === null || tenantId === undefined) return false
  const granted = effectivePermissions(user as CommerceUser, tenantId)
  return MANAGE_COMMERCE_PERMISSIONS.some((p) => granted.has(p))
}

/**
 * Read the acting tenant ID from the multi-tenant plugin's tenant cookie. Returns null when the
 * request lacks the cookie or the DB default ID type is unavailable (e.g. during constructed-config
 * tests that don't boot Payload).
 */
function currentTenantId(req: PayloadRequest): string | null {
  const headers = req?.headers as Headers | undefined
  const defaultIDType = req?.payload?.db?.defaultIDType as 'number' | 'text' | undefined
  if (!headers || !defaultIDType) return null
  const tid = getTenantFromCookie(headers, defaultIDType)
  if (tid === undefined || tid === null) return null
  return String(tid)
}

/** Commerce-admin check for an in-flight request (cookie-aware). */
export function isCommerceAdmin(req: PayloadRequest | undefined | null): boolean {
  if (!req) return false
  return isCommerceAdminForTenant(req.user, currentTenantId(req))
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// The seven commerce access functions.
// ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Field-level access limited to commerce admins. Used by the plugin to gate sensitive fields
 * (e.g. cart `secret`) that no non-admin should read or write.
 */
export const adminOnlyFieldAccess: FieldAccess = ({ req }) =>
  isCommerceAdmin(req as PayloadRequest | undefined)

/**
 * Document is published, OR the acting user is a commerce admin. Used by the plugin for the public
 * catalog `read` slot: admins see everything; everyone else is filtered to `_status: 'published'`.
 */
export const adminOrPublishedStatus: Access = ({ req }) => {
  if (isCommerceAdmin(req as PayloadRequest | undefined)) return true
  return { _status: { equals: 'published' } }
}

/** The acting user is a commerce admin. Used for create/update/delete on staff-only collections. */
export const isAdmin: Access = ({ req }) => isCommerceAdmin(req as PayloadRequest | undefined)

/** Any authenticated Payload user (staff User or customer). */
export const isAuthenticated: Access = ({ req }) => Boolean(req?.user)

/**
 * The acting user is a customer (authenticated via the `customers` collection), not a staff User.
 * Uses the standard Payload convention `user.collection === 'customers'` rather than the absence of
 * `roles` — the previous heuristic (no `roles` array ⇒ customer) could misclassify a staff user
 * with an empty `roles` array, and conversely would be tricked by a customer doc that happened to
 * carry a `roles` key. The super-admin short-circuit is preserved above (in `isCommerceAdmin`).
 */
export const isCustomer: FieldAccess = ({ req }) => {
  const user = req?.user as ({ collection?: string } & UserLike) | null
  if (!user) return false
  if (isSuperAdmin(user)) return false
  return user.collection === 'customers'
}

/**
 * Commerce admins get unrestricted access; otherwise the result is a Where query that restricts
 * documents to those whose `customer` relationship points at the acting customer's ID. Used by the
 * plugin to scope carts/orders/transactions to their owning customer.
 */
export const isDocumentOwner: Access = ({ req }) => {
  if (isCommerceAdmin(req as PayloadRequest | undefined)) return true
  const user = req?.user as { id?: unknown } | null
  if (!user || user.id === undefined) return false
  return { customer: { equals: user.id } }
}

/**
 * Public read access. Commerce admins get unrestricted access; anonymous and non-admin users are
 * filtered to published catalog documents only. Anonymous users NEVER receive `true` here, so this
 * function never grants unrestricted read/create/update/delete to the public — it only narrows read
 * results to the published catalog. The dedicated storefront catalog route enforces the
 * "published-only path" requirement at the route layer (signed CMS store endpoints).
 */
export const publicAccess: Access = ({ req }) => {
  if (isCommerceAdmin(req as PayloadRequest | undefined)) return true
  return { _status: { equals: 'published' } }
}

/**
 * The complete access bundle the integration owner passes to `ecommercePlugin({ access })`.
 * Satisfies the plugin's `AccessConfig` shape (all 7 functions + omits the deprecated
 * `customerOnlyFieldAccess`).
 */
export const commercePluginAccess: AccessConfig = {
  adminOnlyFieldAccess,
  adminOrPublishedStatus,
  isAdmin,
  isAuthenticated,
  isCustomer,
  isDocumentOwner,
  publicAccess,
}
