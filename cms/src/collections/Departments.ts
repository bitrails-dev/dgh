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
    { name: 'slug', type: 'text', required: true, unique: true,
      label: { ar: 'المعرّف', en: 'Slug' },
      admin: { description: 'Markdown filename. Lowercase, hyphenated.' } },
    { name: 'name', type: 'text', required: true, localized: true,
      label: { ar: 'الاسم', en: 'Name' } },
    { name: 'description', type: 'textarea', required: true, localized: true,
      label: { ar: 'الوصف', en: 'Description' } },
    // Icon picked from the managed Icons library (SVG assets).
    { name: 'iconRef', type: 'relationship', relationTo: 'icons',
      label: { ar: 'الأيقونة', en: 'Icon' } },
    // ponytail: legacy icon name kept read-only during transition so nothing renders blank.
    // The reader prefers `iconRef` and falls back to this. Drop in a later cleanup migration.
    { name: 'icon', type: 'text',
      label: { ar: 'الأيقونة (قديم)', en: 'Icon (legacy)' },
      admin: { readOnly: true, description: 'Legacy icon name — superseded by the Icon library.' } },
    { name: 'centerOfExcellence', type: 'checkbox', defaultValue: false,
      label: { ar: 'مركز تميّز', en: 'Center of Excellence' } },
    // Assign this department's doctors from here. Backed by the single FK on each doctor
    // (Doctors.departmentRel), so there is one source of truth.
    { name: 'doctors', type: 'join', collection: 'doctors', on: 'departmentRel',
      label: { ar: 'الأطباء', en: 'Doctors' } },
  ],
}
