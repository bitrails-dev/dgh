import type { CollectionConfig } from 'payload'

export const Media: CollectionConfig = {
  slug: 'media',
  labels: {
    singular: { ar: 'وسيط', en: 'Media' },
    plural: { ar: 'الوسائط', en: 'Media' },
  },
  access: { read: () => true },
  upload: {
    staticDir: '../public/uploads',
    mimeTypes: ['image/*'],
  },
  fields: [
    { name: 'alt', type: 'text', label: { ar: 'النص البديل', en: 'Alt text' } },
  ],
}
