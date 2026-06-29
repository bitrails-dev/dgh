import type { CollectionConfig } from 'payload'

export const Achievements: CollectionConfig = {
  slug: 'achievements',
  labels: {
    singular: { ar: 'إنجاز', en: 'Achievement' },
    plural: { ar: 'الإنجازات', en: 'Achievements' },
  },
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'year'] },
  access: { read: () => true },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true,
      label: { ar: 'المعرّف', en: 'Slug' },
      admin: { description: 'Markdown filename. Lowercase, hyphenated.' } },
    { name: 'year', type: 'number', required: true,
      label: { ar: 'السنة', en: 'Year' } },
    { name: 'title', type: 'text', required: true, localized: true,
      label: { ar: 'العنوان', en: 'Title' } },
    { name: 'description', type: 'textarea', required: true, localized: true,
      label: { ar: 'الوصف', en: 'Description' } },
    { name: 'icon', type: 'text', label: { ar: 'الأيقونة', en: 'Icon' } },
  ],
}
