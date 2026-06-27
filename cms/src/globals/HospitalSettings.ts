import type { GlobalConfig } from 'payload'

// Singleton site config — mirrors src/content/settings/hero.json + contact.json.
// Localized fields export to the `<key>` (en) + `<key>Ar` (ar) JSON shape Astro already reads.

const stat = (name: string, label: string) => ({
  name,
  type: 'group' as const,
  label,
  fields: [
    { name: 'value', type: 'text' as const, localized: true, required: true },
    { name: 'unit', type: 'text' as const, localized: true },
  ],
})

export const HospitalSettings: GlobalConfig = {
  slug: 'hospital-settings',
  access: { read: () => true },
  admin: { group: 'Settings' },
  fields: [
    {
      name: 'hero',
      type: 'group',
      label: 'Hero stats',
      fields: [
        stat('years', 'Years'),
        stat('departments', 'Departments'),
        stat('patients', 'Patients'),
        stat('staff', 'Staff'),
      ],
    },
    {
      name: 'contact',
      type: 'group',
      fields: [
        { name: 'phone', type: 'text' },
        { name: 'emergencyNumber', type: 'text' },
        { name: 'whatsapp', type: 'text' },
        { name: 'email', type: 'email' },
        { name: 'address', type: 'textarea', localized: true },
        {
          name: 'social',
          type: 'group',
          fields: [
            { name: 'facebookUrl', type: 'text' },
            { name: 'xUrl', type: 'text' },
            { name: 'youtubeUrl', type: 'text' },
          ],
        },
        {
          name: 'hours',
          type: 'array',
          fields: [
            { name: 'day', type: 'text', localized: true, required: true },
            { name: 'time', type: 'text', localized: true, required: true },
          ],
        },
      ],
    },
  ],
}
