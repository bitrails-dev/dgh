import type { CollectionConfig } from 'payload'

export const Doctors: CollectionConfig = {
  slug: 'doctors',
  labels: {
    singular: { ar: 'طبيب', en: 'Doctor' },
    plural: { ar: 'الأطباء', en: 'Doctors' },
  },
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'specialty', 'order', 'featured'] },
  access: { read: () => true },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true,
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
    // Relationship to a department (single). Assignable from the department side via a `join`.
    { name: 'departmentRel', type: 'relationship', relationTo: 'departments',
      label: { ar: 'القسم', en: 'Department' } },
    // ponytail: legacy slug text kept read-only during transition so no link is lost. The reader
    // prefers `departmentRel` and falls back to this. Drop in a later cleanup migration.
    { name: 'department', type: 'text',
      label: { ar: 'القسم (قديم)', en: 'Department (legacy)' },
      admin: { readOnly: true, description: 'Legacy department slug — superseded by the Department relationship.' } },
    { name: 'certified', type: 'checkbox', defaultValue: false,
      label: { ar: 'معتمد', en: 'Certified' } },
    { name: 'featured', type: 'checkbox', defaultValue: false,
      label: { ar: 'مميّز', en: 'Featured' } },
    { name: 'order', type: 'number',
      label: { ar: 'الترتيب', en: 'Sort Order' },
      admin: { description: { ar: 'ترتيب العرض — الرقم الأصغر يظهر أولاً', en: 'Display precedence — lower numbers appear first' } } },
  ],
}
