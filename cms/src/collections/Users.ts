import type { CollectionConfig } from 'payload'

// Auth collection — replaces the old admin-token-in-client-bundle. Editors log in here.
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  labels: {
    singular: { ar: 'مستخدم', en: 'User' },
    plural: { ar: 'المستخدمون', en: 'Users' },
  },
  admin: { useAsTitle: 'email' },
  fields: [
    { name: 'name', type: 'text', label: { ar: 'الاسم', en: 'Name' } },
    // super-admin = platform operator: bypasses tenant scoping (see payload.config
    // userHasAccessToAllTenants). Tenant staff have no role and are limited to their
    // assigned tenant(s) via the plugin-injected `tenants` array field.
    { name: 'roles', type: 'select', hasMany: true, defaultValue: ['super-admin'],
      label: { ar: 'الأدوار', en: 'Roles' },
      options: [{ value: 'super-admin', label: { ar: 'مشرف عام', en: 'Super admin' } }] },
  ],
}
