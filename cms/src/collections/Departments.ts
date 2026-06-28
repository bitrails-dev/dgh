import type { CollectionConfig } from 'payload'

export const Departments: CollectionConfig = {
  slug: 'departments',
  labels: {
    singular: { ar: 'قسم', en: 'Department' },
    plural: { ar: 'الأقسام', en: 'Departments' },
  },
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'centerOfExcellence'] },
  access: { read: () => true },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true, index: true,
      label: { ar: 'المعرّف', en: 'Slug' },
      admin: { description: 'Markdown filename. Lowercase, hyphenated.' } },
    { name: 'name', type: 'text', required: true, localized: true,
      label: { ar: 'الاسم', en: 'Name' } },
    { name: 'description', type: 'textarea', required: true, localized: true,
      label: { ar: 'الوصف', en: 'Description' } },
    { name: 'icon', type: 'text', required: true,
      label: { ar: 'الأيقونة', en: 'Icon' },
      admin: { description: 'Icon name' } },
    { name: 'centerOfExcellence', type: 'checkbox', defaultValue: false,
      label: { ar: 'مركز تميّز', en: 'Center of Excellence' } },
  ],
}
