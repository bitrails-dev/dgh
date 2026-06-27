import type { CollectionConfig } from 'payload'

export const Awards: CollectionConfig = {
  slug: 'awards',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'year'] },
  access: { read: () => true },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true, index: true,
      admin: { description: 'Markdown filename. Lowercase, hyphenated.' } },
    { name: 'name', type: 'text', required: true, localized: true },
    { name: 'body', type: 'textarea', required: true, localized: true },
    { name: 'year', type: 'number', required: true },
    { name: 'badgeImage', type: 'text', admin: { description: 'Image URL' } },
  ],
}
