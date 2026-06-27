import type { CollectionConfig } from 'payload'

// Auth collection — replaces the old admin-token-in-client-bundle. Editors log in here.
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: { useAsTitle: 'email' },
  fields: [
    { name: 'name', type: 'text' },
  ],
}
