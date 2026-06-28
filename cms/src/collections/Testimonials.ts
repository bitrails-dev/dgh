import type { CollectionConfig } from 'payload'

export const Testimonials: CollectionConfig = {
  slug: 'testimonials',
  labels: {
    singular: { ar: 'شهادة', en: 'Testimonial' },
    plural: { ar: 'الشهادات', en: 'Testimonials' },
  },
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'featured'] },
  access: { read: () => true },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true, index: true,
      label: { ar: 'المعرّف', en: 'Slug' },
      admin: { description: 'Markdown filename. Lowercase, hyphenated.' } },
    { name: 'name', type: 'text', required: true, localized: true,
      label: { ar: 'الاسم', en: 'Name' } },
    { name: 'quote', type: 'textarea', required: true, localized: true,
      label: { ar: 'النص', en: 'Quote' } },
    { name: 'caseType', type: 'text', localized: true,
      label: { ar: 'نوع الحالة', en: 'Case type' } },
    { name: 'avatar', type: 'upload', relationTo: 'media',
      label: { ar: 'الصورة الرمزية', en: 'Avatar' } },
    { name: 'featured', type: 'checkbox', defaultValue: false,
      label: { ar: 'مميّز', en: 'Featured' } },
  ],
}
