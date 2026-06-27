import type { CollectionConfig } from 'payload'

const CATEGORIES = ['procedure', 'event', 'announcement'] as const

export const Events: CollectionConfig = {
  slug: 'events',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'date', 'category', 'featured'] },
  access: { read: () => true },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true, index: true,
      admin: { description: 'Markdown filename. Lowercase, hyphenated.' } },
    { name: 'title', type: 'text', required: true, localized: true },
    { name: 'date', type: 'date', required: true },
    { name: 'category', type: 'select', required: true,
      options: CATEGORIES.map((c) => ({ label: c, value: c })) },
    { name: 'summary', type: 'textarea', required: true, localized: true },
    { name: 'thumbnail', type: 'text', admin: { description: 'Image URL' } },
    { name: 'featured', type: 'checkbox', defaultValue: false },
    { name: 'youtubeUrl', type: 'text' },
    { name: 'gallery', type: 'array', fields: [
      { name: 'url', type: 'text', required: true },
      { name: 'caption', type: 'text', localized: true },
      { name: 'alt', type: 'text', required: true },
    ] },
    { name: 'body', type: 'textarea', admin: { description: 'Markdown body' } },
  ],
}
