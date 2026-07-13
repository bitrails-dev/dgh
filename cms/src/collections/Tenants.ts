import type { CollectionConfig } from 'payload'

// A tenant is an "entity" — a hospital or a clinic. The public site resolves one per request
// (by hostname / TENANT_SLUG) and every content collection is scoped to it via the multi-tenant
// plugin. `features` is the configurable capability set that gates the tenant's public site
// (nav items, homepage sections, routes). Extend the list below to add a new gated capability.

// value ↔ the frontend hasFeature() keys in src/lib/tenant.ts. Keep the two in sync.
export const TENANT_FEATURES = [
  { value: 'departments', label: { ar: 'الأقسام', en: 'Departments' } },
  { value: 'team', label: { ar: 'الفريق الطبي', en: 'Team' } },
  { value: 'articles', label: { ar: 'المقالات', en: 'Articles' } },
  { value: 'events', label: { ar: 'الفعاليات', en: 'Events' } },
  { value: 'awards', label: { ar: 'الجوائز', en: 'Awards' } },
  { value: 'achievements', label: { ar: 'الإنجازات', en: 'Achievements' } },
  { value: 'testimonials', label: { ar: 'شهادات المرضى', en: 'Testimonials' } },
  { value: 'portal', label: { ar: 'بوابة المرضى', en: 'Patient portal' } },
]

// Mirrors the old HospitalSettings.stat — a localized value+unit pair.
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

export const Tenants: CollectionConfig = {
  slug: 'tenants',
  labels: {
    singular: { ar: 'جهة', en: 'Entity' },
    plural: { ar: 'الجهات', en: 'Entities' },
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'type', 'slug'],
    group: { ar: 'الإعدادات', en: 'Settings' },
  },
  // Public: the Astro site fetches tenants unauthenticated to resolve one by host/slug.
  access: { read: () => true },
  fields: [
    { name: 'name', type: 'text', required: true, localized: true,
      label: { ar: 'الاسم', en: 'Name' } },
    { name: 'slug', type: 'text', required: true, unique: true,
      label: { ar: 'المعرّف', en: 'Slug' },
      admin: { description: 'Lowercase, hyphenated. Used by TENANT_SLUG and as a stable key.' } },
    { name: 'type', type: 'select', required: true, defaultValue: 'hospital',
      label: { ar: 'النوع', en: 'Type' },
      options: [
        { value: 'hospital', label: { ar: 'مستشفى', en: 'Hospital' } },
        { value: 'clinic', label: { ar: 'عيادة', en: 'Clinic' } },
      ] },
    { name: 'domains', type: 'text', hasMany: true,
      label: { ar: 'النطاقات', en: 'Domains' },
      admin: { description: 'Hostnames that map to this tenant, e.g. dgh.bitrail.dev, localhost.' } },
    { name: 'features', type: 'select', hasMany: true, options: TENANT_FEATURES,
      label: { ar: 'القدرات', en: 'Capabilities' },
      admin: { description: 'Which sections/pages this entity shows. A clinic can omit Team, etc.' } },
    {
      name: 'branding',
      type: 'group',
      label: { ar: 'الهوية', en: 'Branding' },
      fields: [
        { name: 'initials', type: 'text', label: { ar: 'الأحرف الأولى', en: 'Initials' } },
        { name: 'tagline', type: 'text', localized: true, label: { ar: 'الشعار النصي', en: 'Tagline' } },
        { name: 'established', type: 'text', localized: true, label: { ar: 'سنة التأسيس', en: 'Established' } },
        { name: 'logo', type: 'upload', relationTo: 'media', label: { ar: 'الشعار', en: 'Logo' } },
        { name: 'themeColor', type: 'text', label: { ar: 'اللون الأساسي', en: 'Theme color' },
          admin: { description: 'Hex, e.g. #15504f.' } },
      ],
    },
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
