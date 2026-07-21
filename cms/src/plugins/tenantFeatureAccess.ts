import { getTenantFromCookie } from '@payloadcms/plugin-multi-tenant/utilities'
import { APIError } from 'payload'
import type {
  Access,
  AccessArgs,
  AccessResult,
  CollectionBeforeChangeHook,
  Config,
  Plugin,
  Where,
} from 'payload'
import { getUserTenantIDs, isSuperAdmin } from '../access/userAccess'
import type { TenantFeature } from '../collections/tenantFeatures'

// Re-exported for backward compatibility: existing imports resolve the feature key union from the
// plugin path. The canonical definition lives in collections/tenantFeatures.ts so the catalogue can
// be shared with TenantTypes.ts without a circular import (the plugin gates collections/routes,
// while TenantTypes needs only the labelled option list).
export type { TenantFeature }

type FeatureRequirement = TenantFeature | readonly TenantFeature[]
type FeaturePolicy = {
  features?: FeatureRequirement
  tenantScoped: boolean
}

export const TENANT_COLLECTION_FEATURES = {
  departments: { features: 'departments', tenantScoped: true },
  doctors: { features: 'team', tenantScoped: true },
  articles: { features: 'articles', tenantScoped: true },
  events: { features: 'events', tenantScoped: true },
  awards: { features: 'awards', tenantScoped: true },
  achievements: { features: 'achievements', tenantScoped: true },
  testimonials: { features: 'testimonials', tenantScoped: true },
  categories: { features: ['articles', 'events'], tenantScoped: true },
  // Every entity can manage branding assets even when no content capability is enabled.
  media: { tenantScoped: true },
  icons: { features: 'departments', tenantScoped: false },
  // Commerce inventory — gated on the `commerce` feature. All five collections are tenant-scoped.
  'inventory-locations': { features: 'commerce', tenantScoped: true },
  'inventory-levels': { features: 'commerce', tenantScoped: true },
  'stock-movements': { features: 'commerce', tenantScoped: true },
  'stock-reservations': { features: 'commerce', tenantScoped: true },
  'inventory-transfers': { features: 'commerce', tenantScoped: true },
  'commerce-settings': { features: 'commerce', tenantScoped: true },
  'payment-events': { features: 'commerce', tenantScoped: true },
  orders: { features: 'commerce', tenantScoped: true },
  transactions: { features: 'commerce', tenantScoped: true },
  products: { features: 'commerce', tenantScoped: true },
  carts: { features: 'commerce', tenantScoped: true },
  customers: { features: 'commerce', tenantScoped: true },
} as const satisfies Record<string, FeaturePolicy>

type SelectedTenant = {
  features: ReadonlySet<string>
  id: number | string
}

const selectedTenants = new WeakMap<object, Promise<SelectedTenant | null>>()

const loadSelectedTenant = async (
  req: AccessArgs['req'],
): Promise<SelectedTenant | null> => {
  const assignedTenantIDs = getUserTenantIDs(req.user)
  const cookieTenantID = getTenantFromCookie(req.headers, req.payload.db.defaultIDType)

  // Super-admin carries no tenant-assignment row, so the membership check below can never pass for
  // them — but the whole point of the sidebar filter is that a super-admin picks an arbitrary tenant
  // to scope the UI to. Trust the cookie for super-admins; a stale/deleted ID still fails closed via
  // the findByID try/catch below. Non-super users keep the membership + single-assignment fallback.
  let selectedTenantID: string | number | null
  if (isSuperAdmin(req.user)) {
    selectedTenantID = cookieTenantID
  } else {
    selectedTenantID = cookieTenantID ?? (assignedTenantIDs.length === 1 ? assignedTenantIDs[0] : null)
    if (selectedTenantID === null || !assignedTenantIDs.includes(String(selectedTenantID))) {
      return null
    }
  }

  // No cookie means "no tenant selected". For super-admin this preserves the cross-tenant aggregate
  // view (the caller treats null as "do not apply the feature gate"); for everyone else it was
  // already handled above.
  if (selectedTenantID === null) return null

  try {
    const tenant = await req.payload.findByID({
      collection: 'tenants',
      id: selectedTenantID,
      depth: 0,
      overrideAccess: true,
      req,
      select: { features: true },
    }) as { features?: string[] | null }

    return {
      features: new Set(tenant.features ?? []),
      id: selectedTenantID,
    }
  } catch {
    // A deleted/stale tenant cookie or a failed lookup must never expose capability collections.
    return null
  }
}

export const getSelectedTenant = (
  req: AccessArgs['req'],
): Promise<SelectedTenant | null> => {
  const cached = selectedTenants.get(req)
  if (cached) return cached

  const tenant = loadSelectedTenant(req)
  selectedTenants.set(req, tenant)
  return tenant
}

const tenantEnablesPolicy = (tenant: SelectedTenant, policy: FeaturePolicy): boolean => {
  if (!policy.features) return true
  const requiredFeatures = Array.isArray(policy.features) ? policy.features : [policy.features]
  return requiredFeatures.some((feature) => tenant.features.has(feature))
}

const constrainToSelectedTenant = (
  accessResult: AccessResult,
  selectedTenantID: number | string,
): AccessResult => {
  const tenantConstraint: Where = { tenant: { equals: selectedTenantID } }
  return accessResult === true
    ? tenantConstraint
    : { and: [accessResult as Where, tenantConstraint] }
}

const withTenantFeatureAccess = (
  access: Access | undefined,
  operation: 'create' | 'delete' | 'read' | 'update',
  policy: FeaturePolicy,
): Access => async (args) => {
  const baseAccess = access ?? (({ req }: AccessArgs) => Boolean(req.user))
  const accessResult = await baseAccess(args)

  if (!accessResult || !args.req.user) return accessResult

  const superAdmin = isSuperAdmin(args.req.user)
  const selectedTenant = await getSelectedTenant(args.req)

  // No tenant selected: a super-admin keeps cross-tenant access (the sidebar shows every collection);
  // any other user is blocked until they pick one.
  if (!selectedTenant) return superAdmin ? accessResult : false

  // The feature gate applies to everyone, including super-admin, keyed on the SELECTED tenant's
  // capabilities. This is what hides commerce (and other capability collections) from the sidebar
  // when the super-admin filters to a tenant that didn't buy that capability.
  if (!tenantEnablesPolicy(selectedTenant, policy)) return false

  // Super-admin is never row-scope-constrained: the sidebar filter governs WHICH collections are
  // visible, not whose rows. Aggregate cross-tenant lists must keep working.
  if (superAdmin) return accessResult

  if (!policy.tenantScoped || operation === 'create') return accessResult
  return constrainToSelectedTenant(accessResult, selectedTenant.id)
}

const relationID = (relation: unknown): string | null => {
  if (typeof relation === 'number' || typeof relation === 'string') return String(relation)
  if (relation && typeof relation === 'object' && 'id' in relation) {
    const id = (relation as { id?: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? String(id) : null
  }
  return null
}

const enforceSelectedTenant = (policy: FeaturePolicy): CollectionBeforeChangeHook => async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (!req.user) return data

  const superAdmin = isSuperAdmin(req.user)
  const selectedTenant = await getSelectedTenant(req)

  // No tenant selected: a super-admin may still write (cross-tenant tooling/migrations); any other
  // user must pick one first.
  if (!selectedTenant) {
    if (superAdmin) return data
    throw new APIError('Select a tenant before managing this collection.', 403, null, true)
  }

  // Feature gate on writes too — symmetric with the access layer. Stops a super-admin (or anyone)
  // from creating commerce docs for a tenant that didn't enable the capability.
  if (!tenantEnablesPolicy(selectedTenant, policy)) {
    throw new APIError('The selected tenant does not enable this collection.', 403, null, true)
  }

  // Super-admin is never row-scope-constrained.
  if (superAdmin) return data

  if (!policy.tenantScoped) return data

  const documentTenantID = relationID(data.tenant ?? originalDoc?.tenant)
  if (operation === 'create' && !documentTenantID) {
    data.tenant = selectedTenant.id
    return data
  }

  if (documentTenantID !== String(selectedTenant.id)) {
    throw new APIError('Documents can only be managed within the selected tenant.', 403, null, true)
  }

  return data
}

export const tenantFeatureAccessPlugin = (): Plugin => (incomingConfig: Config): Config => {
  for (const [slug, policy] of Object.entries(TENANT_COLLECTION_FEATURES)) {
    const collection = incomingConfig.collections?.find((candidate) => candidate.slug === slug)
    if (!collection) continue

    collection.access = collection.access ?? {}
    for (const operation of ['create', 'read', 'update', 'delete'] as const) {
      collection.access[operation] = withTenantFeatureAccess(
        collection.access[operation],
        operation,
        policy,
      )
    }

    collection.hooks = collection.hooks ?? {}
    collection.hooks.beforeChange = [
      ...(collection.hooks.beforeChange ?? []),
      enforceSelectedTenant(policy),
    ]

    // Surface tenant ownership for super-admin aggregate lists. The multi-tenant plugin injects the
    // required `tenant` relationship with BOTH `disableListColumn` and `disableListFilter` set true,
    // so the ownership column and filter are hidden even from a super-admin who can read every
    // tenant. Flip both back on and add `tenant` to default columns. UI visibility never broadens
    // API access: non-super users stay constrained by the access layer above and by the field's own
    // filterOptions (their assigned tenants only). Collections without an injected tenant field
    // (e.g. the shared `icons` library) are left untouched.
    const tenantField = collection.fields?.find(
      (f): f is Extract<typeof f, { name?: string }> => 'name' in f && (f as { name?: string }).name === 'tenant',
    ) as { type?: string; admin?: Record<string, unknown> } | undefined
    if (tenantField && tenantField.type === 'relationship') {
      tenantField.admin = tenantField.admin ?? {}
      tenantField.admin.disableListColumn = false
      tenantField.admin.disableListFilter = false

      const defaultColumns = collection.admin?.defaultColumns
      if (Array.isArray(defaultColumns)) {
        if (!defaultColumns.includes('tenant')) defaultColumns.push('tenant')
      } else {
        collection.admin = { ...(collection.admin ?? {}), defaultColumns: ['tenant'] }
      }
    }
  }

  return incomingConfig
}
