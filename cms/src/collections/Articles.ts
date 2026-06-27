import type { CollectionConfig } from 'payload'

const CATEGORIES = ['hospital-news', 'health-tips', 'research', 'events'] as const

export const Articles: CollectionConfig = {
  slug: 'articles',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'date', 'category', 'featured'] },
  access: { read: () => true },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true, index: true,
      admin: { description: 'Markdown filename. Lowercase, hyphenated.' } },
    { name: 'title', type: 'text', required: true, localized: true },
    { name: 'date', type: 'date', required: true },
    { name: 'author', type: 'text', required: true },
    { name: 'category', type: 'select', required: true,
      options: CATEGORIES.map((c) => ({ label: c, value: c })) },
    { name: 'thumbnail', type: 'text', required: true, admin: { description: 'Image URL' } },
    { name: 'featured', type: 'checkbox', defaultValue: false },
    // ponytail: single markdown body (matches current one-body-per-file). Make localized if
    // articles ever need separate AR/EN bodies.
    { name: 'body', type: 'textarea', admin: { description: 'Markdown body' } },
  ],
}
