import type { CollectionConfig } from 'payload'

export const Awards: CollectionConfig = {
  slug: 'awards',
  labels: {
    singular: { ar: 'جائزة', en: 'Award' },
    plural: { ar: 'الجوائز', en: 'Awards' },
  },
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'year'] },
  access: { read: () => true },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true, index: true,
      label: { ar: 'المعرّف', en: 'Slug' },
      admin: { description: 'Markdown filename. Lowercase, hyphenated.' } },
    { name: 'name', type: 'text', required: true, localized: true,
      label: { ar: 'الاسم', en: 'Name' } },
    { name: 'body', type: 'textarea', required: true, localized: true,
      label: { ar: 'المحتوى', en: 'Body' } },
    { name: 'year', type: 'number', required: true,
      label: { ar: 'السنة', en: 'Year' } },
    { name: 'badgeImage', type: 'text',
      label: { ar: 'صورة الشارة', en: 'Badge image' },
      admin: { description: 'Image URL' } },
  ],
}
