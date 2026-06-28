import type { GlobalConfig } from 'payload'

// Singleton site config — mirrors src/content/settings/hero.json + contact.json.
// Localized fields export to the `<key>` (en) + `<key>Ar` (ar) JSON shape Astro already reads.

const stat = (name: string, ar: string, en: string) => ({
  name,
  type: 'group' as const,
  label: { ar, en },
  fields: [
    { name: 'value', type: 'text' as const, localized: true, required: true,
      label: { ar: 'القيمة', en: 'Value' } },
    { name: 'unit', type: 'text' as const, localized: true,
      label: { ar: 'الوحدة', en: 'Unit' } },
  ],
})

export const HospitalSettings: GlobalConfig = {
  slug: 'hospital-settings',
  label: { ar: 'إعدادات المستشفى', en: 'Hospital Settings' },
  access: { read: () => true },
  admin: { group: { ar: 'الإعدادات', en: 'Settings' } },
  fields: [
    {
      name: 'hero',
      type: 'group',
      label: { ar: 'إحصائيات الواجهة', en: 'Hero stats' },
      fields: [
        stat('years', 'سنوات', 'Years'),
        stat('departments', 'الأقسام', 'Departments'),
        stat('patients', 'المرضى', 'Patients'),
        stat('staff', 'الطاقم', 'Staff'),
      ],
    },
    {
      name: 'contact',
      type: 'group',
      label: { ar: 'معلومات التواصل', en: 'Contact' },
      fields: [
        { name: 'phone', type: 'text', label: { ar: 'الهاتف', en: 'Phone' } },
        { name: 'emergencyNumber', type: 'text', label: { ar: 'رقم الطوارئ', en: 'Emergency number' } },
        { name: 'whatsapp', type: 'text', label: { ar: 'واتساب', en: 'WhatsApp' } },
        { name: 'email', type: 'email', label: { ar: 'البريد الإلكتروني', en: 'Email' } },
        { name: 'address', type: 'textarea', localized: true, label: { ar: 'العنوان', en: 'Address' } },
        {
          name: 'social',
          type: 'group',
          label: { ar: 'وسائل التواصل', en: 'Social' },
          fields: [
            { name: 'facebookUrl', type: 'text', label: { ar: 'فيسبوك', en: 'Facebook' } },
            { name: 'xUrl', type: 'text', label: { ar: 'إكس', en: 'X' } },
            { name: 'youtubeUrl', type: 'text', label: { ar: 'يوتيوب', en: 'YouTube' } },
          ],
        },
        {
          name: 'hours',
          type: 'array',
          label: { ar: 'ساعات العمل', en: 'Hours' },
          fields: [
            { name: 'day', type: 'text', localized: true, required: true, label: { ar: 'اليوم', en: 'Day' } },
            { name: 'time', type: 'text', localized: true, required: true, label: { ar: 'الوقت', en: 'Time' } },
          ],
        },
      ],
    },
  ],
}
