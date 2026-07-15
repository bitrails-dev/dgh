import type { CollectionConfig } from 'payload'
import {
  authenticatedFieldAccess,
  enforceUserDeleteScope,
  enforceUserScope,
  isSuperAdmin,
  isTenantAdmin,
  manageUserScopeFieldAccess,
} from '../access/userAccess'

// Auth collection — replaces the old admin-token-in-client-bundle. Editors log in here.
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  labels: {
    singular: { ar: 'مستخدم', en: 'User' },
    plural: { ar: 'المستخدمون', en: 'Users' },
  },
  admin: { useAsTitle: 'email' },
  // The multi-tenant plugin ANDs its tenant constraint with these collection rules for
  // non-super-admins. The hooks below also reject cross-tenant assignments and mutations.
  access: {
    create: ({ req }) => isSuperAdmin(req.user) || isTenantAdmin(req.user),
    read: ({ req }) => {
      if (isSuperAdmin(req.user) || isTenantAdmin(req.user)) return true
      return req.user ? { id: { equals: req.user.id } } : false
    },
    update: ({ req }) => {
      if (isSuperAdmin(req.user) || isTenantAdmin(req.user)) return true
      return req.user ? { id: { equals: req.user.id } } : false
    },
    delete: ({ req }) => {
      if (isSuperAdmin(req.user)) return true
      if (!isTenantAdmin(req.user)) return false
      return { id: { not_equals: req.user?.id } }
    },
  },
  hooks: {
    beforeChange: [enforceUserScope],
    beforeDelete: [enforceUserDeleteScope],
  },
  fields: [
    { name: 'name', type: 'text', label: { ar: 'الاسم', en: 'Name' } },
    // The multi-tenant plugin injects the `tenants` array. Collection access is additionally
    // constrained by that field, while the hook above prevents cross-tenant assignment.
    { name: 'roles', type: 'select', hasMany: true, required: true, defaultValue: ['editor'],
      saveToJWT: true,
      access: {
        read: authenticatedFieldAccess,
        create: manageUserScopeFieldAccess,
        update: manageUserScopeFieldAccess,
      },
      label: { ar: 'الأدوار', en: 'Roles' },
      options: [
        { value: 'super-admin', label: { ar: 'مشرف عام', en: 'Super admin' } },
        { value: 'admin', label: { ar: 'مشرف الجهة', en: 'Tenant admin' } },
        { value: 'editor', label: { ar: 'محرر', en: 'Editor' } },
      ] },
  ],
}
