import type { CollectionConfig } from 'payload'

export const Achievements: CollectionConfig = {
  slug: 'achievements',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'year'] },
  access: { read: () => true },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true, index: true,
      admin: { description: 'Markdown filename. Lowercase, hyphenated.' } },
    { name: 'year', type: 'number', required: true },
    { name: 'title', type: 'text', required: true, localized: true },
    { name: 'description', type: 'textarea', required: true, localized: true },
    { name: 'icon', type: 'text' },
  ],
}
