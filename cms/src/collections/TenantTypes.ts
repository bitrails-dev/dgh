import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'
import { isSuperAdmin } from '../access/userAccess'
import { TENANT_FEATURES } from './tenantFeatures'

// Platform-wide, database-extensible Tenant Types. Each type carries a `defaultFeatures` template
// copied into a new Tenant when its `features` value is omitted (see Tenants.copyTypeDefaultFeatures).
//
// The feature *keys* remain code-defined (tenantFeatures.ts) because they gate collections/routes;
// only the *type* and its feature combination are data-driven, so a new type needs no deployment.
//
// Access: a super-admin can create/update/delete. Read is public: the fields are non-secret type
// identity (localized label, slug, default feature template), and the public site resolves a
// tenant's type from the anonymous `/api/tenants?depth=1` response. Tenant admins cannot mutate
// types. Deletion is rejected with a clear 400 while any Tenant still references the type.

// Stable prefix used by the beforeDelete guard and asserted by tests.
export const REFERENCED_TYPE_DELETE_MESSAGE =
  'Cannot delete a Tenant Type that is still referenced by one or more tenants.'

export const TenantTypes: CollectionConfig = {
  slug: 'tenant-types',
  labels: {
    singular: { ar: 'نوع الجهة', en: 'Entity type' },
    plural: { ar: 'أنواع الجهات', en: 'Entity types' },
  },
  admin: {
    // Visible in the admin nav only to super-admins. The collection's data remains publicly readable
    // (access.read: () => true) so the anonymous frontend can resolve a tenant's type identity — only
    // the admin UI visibility is restricted here.
    hidden: ({ user }) => !isSuperAdmin(user),
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug'],
    group: { ar: 'الإعدادات', en: 'Settings' },
  },
  access: {
    // Public read: the public frontend resolves a tenant's type identity from the populated
    // relationship without authentication. Only the non-secret slug/name/defaultFeatures are stored.
    read: () => true,
    create: ({ req }) => isSuperAdmin(req.user),
    update: ({ req }) => isSuperAdmin(req.user),
    delete: ({ req }) => isSuperAdmin(req.user),
  },
  hooks: {
    // Reject deletion with a clear 400 if any Tenant still references this type. Prevents orphaned
    // tenants whose required `type` relationship would otherwise become unresolved.
    beforeDelete: [
      async ({ req, id }) => {
        const { totalDocs } = await req.payload.count({
          collection: 'tenants',
          where: { type: { equals: id } },
          req,
        })
        if (totalDocs > 0) {
          throw new APIError(
            `${REFERENCED_TYPE_DELETE_MESSAGE} (${totalDocs} tenant(s) still reference it.)`,
            400,
            null,
            true,
          )
        }
      },
    ],
  },
  fields: [
    { name: 'name', type: 'text', required: true, localized: true,
      label: { ar: 'الاسم', en: 'Name' } },
    { name: 'slug', type: 'text', required: true, unique: true,
      label: { ar: 'المعرّف', en: 'Slug' },
      admin: { description: 'Lowercase, hyphenated. Stable key referenced by tenants and the frontend.' } },
    // Default feature template copied into a new Tenant of this type when `features` is omitted.
    // Feature keys are code-defined (gate routes/collections); only their combination is extensible.
    { name: 'defaultFeatures', type: 'select', hasMany: true, options: TENANT_FEATURES,
      label: { ar: 'القدرات الافتراضية', en: 'Default capabilities' },
      admin: { description: 'Copied into a new entity of this type when its capabilities are left blank.' } },
  ],
}

// Kept for type narrowing in consumers/tests without importing the full collection config.
export type TenantTypeLike = { id: number | string; slug: string; defaultFeatures?: string[] | null }
