import type { CollectionConfig } from 'payload'

export const Doctors: CollectionConfig = {
  slug: 'doctors',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'specialty', 'featured'] },
  access: { read: () => true },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true, index: true,
      admin: { description: 'Markdown filename. Lowercase, hyphenated.' } },
    { name: 'name', type: 'text', required: true, localized: true },
    { name: 'specialty', type: 'text', required: true, localized: true },
    { name: 'photo', type: 'text', admin: { description: 'Image URL' } },
    { name: 'bio', type: 'textarea', localized: true },
    // ponytail: department is a slug string (matches current markdown), not a relationship.
    // Swap to a relationship to 'departments' if you want referential integrity in the admin.
    { name: 'department', type: 'text', admin: { description: 'Department slug' } },
    { name: 'certified', type: 'checkbox', defaultValue: false },
    { name: 'featured', type: 'checkbox', defaultValue: false },
    { name: 'order', type: 'number' },
  ],
}
