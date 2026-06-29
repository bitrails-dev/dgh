import type { CollectionConfig } from 'payload'

export const Doctors: CollectionConfig = {
  slug: 'doctors',
  labels: {
    singular: { ar: 'طبيب', en: 'Doctor' },
    plural: { ar: 'الأطباء', en: 'Doctors' },
  },
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'specialty', 'order', 'featured'], defaultSort: 'order' },
  access: { read: () => true },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true, index: true,
      label: { ar: 'المعرّف', en: 'Slug' },
      admin: { description: 'Markdown filename. Lowercase, hyphenated.' } },
    { name: 'name', type: 'text', required: true, localized: true,
      label: { ar: 'الاسم', en: 'Name' } },
    { name: 'specialty', type: 'text', required: true, localized: true,
      label: { ar: 'التخصص', en: 'Specialty' } },
    { name: 'photo', type: 'upload', relationTo: 'media',
      label: { ar: 'الصورة', en: 'Photo' } },
    { name: 'bio', type: 'textarea', localized: true,
      label: { ar: 'السيرة الذاتية', en: 'Bio' } },
    // ponytail: department is a slug string (matches current markdown), not a relationship.
    // Swap to a relationship to 'departments' if you want referential integrity in the admin.
    { name: 'department', type: 'text',
      label: { ar: 'القسم', en: 'Department' },
      admin: { description: 'Department slug' } },
    { name: 'certified', type: 'checkbox', defaultValue: false,
      label: { ar: 'معتمد', en: 'Certified' } },
    { name: 'featured', type: 'checkbox', defaultValue: false,
      label: { ar: 'مميّز', en: 'Featured' } },
    { name: 'order', type: 'number',
      label: { ar: 'الترتيب', en: 'Sort Order' },
      admin: { description: { ar: 'ترتيب العرض — الرقم الأصغر يظهر أولاً', en: 'Display precedence — lower numbers appear first' } } },
  ],
}
