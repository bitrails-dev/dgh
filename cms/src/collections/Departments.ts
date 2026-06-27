import type { CollectionConfig } from 'payload'

export const Departments: CollectionConfig = {
  slug: 'departments',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'centerOfExcellence'] },
  access: { read: () => true },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true, index: true,
      admin: { description: 'Markdown filename. Lowercase, hyphenated.' } },
    { name: 'name', type: 'text', required: true, localized: true },
    { name: 'description', type: 'textarea', required: true, localized: true },
    { name: 'icon', type: 'text', required: true, admin: { description: 'Icon name' } },
    { name: 'centerOfExcellence', type: 'checkbox', defaultValue: false },
  ],
}
