import type { CollectionConfig } from 'payload'

export const Testimonials: CollectionConfig = {
  slug: 'testimonials',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'featured'] },
  access: { read: () => true },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true, index: true,
      admin: { description: 'Markdown filename. Lowercase, hyphenated.' } },
    { name: 'name', type: 'text', required: true, localized: true },
    { name: 'quote', type: 'textarea', required: true, localized: true },
    { name: 'caseType', type: 'text', localized: true },
    { name: 'avatar', type: 'text', admin: { description: 'Image URL' } },
    { name: 'featured', type: 'checkbox', defaultValue: false },
  ],
}
