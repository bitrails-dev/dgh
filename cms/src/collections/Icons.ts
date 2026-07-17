import type { CollectionConfig } from 'payload'
import { isSuperAdmin } from '../access/userAccess'

// Managed library of SVG icons (e.g. SDG icons) that departments reference. Curated & reusable —
// upload once, assign to many departments. SVG-only so they stay crisp and themeable.
export const Icons: CollectionConfig = {
  slug: 'icons',
  labels: {
    singular: { ar: 'أيقونة', en: 'Icon' },
    plural: { ar: 'الأيقونات', en: 'Icons' },
  },
  admin: { useAsTitle: 'label', defaultColumns: ['label', 'updatedAt'] },
  access: {
    read: () => true,
    create: ({ req }) => isSuperAdmin(req.user),
    update: ({ req }) => isSuperAdmin(req.user),
    delete: ({ req }) => isSuperAdmin(req.user),
  },
  upload: {
    staticDir: '../public/uploads/icons',
    mimeTypes: ['image/svg+xml'],
  },
  fields: [
    { name: 'label', type: 'text', required: true,
      label: { ar: 'الاسم', en: 'Label' },
      admin: { description: 'Human name, e.g. "SDG 3 — Good Health".' } },
  ],
}
