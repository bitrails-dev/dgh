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
  ],
}
