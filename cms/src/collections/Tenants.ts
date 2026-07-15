import type { CollectionConfig, FieldAccess } from 'payload'
import { getUserTenantIDs, isSuperAdmin, isTenantAdmin } from '../access/userAccess'
import type { UserLike } from '../access/userAccess'
import type { TenantFeature } from '../plugins/tenantFeatureAccess'
import {
  ALL_TENANT_SETTING_GROUPS,
  TENANT_SETTING_GROUPS,
  enforceTenantSettingsEntitlement,
  entitlementIncludes,
} from '../access/tenantSettings'
import type { TenantSettingGroup } from '../access/tenantSettings'

// A tenant is an "entity" — a hospital or a clinic. The public site resolves one per request
// (by hostname / TENANT_SLUG) and every content collection is scoped to it via the multi-tenant
// plugin. `features` gates both public-site sections/routes and related Payload collections.
// Extend the list and the collection map in tenantFeatureAccess.ts for a new gated capability.

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
] satisfies Array<{
  value: TenantFeature
  label: { ar: string; en: string }
}>

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

const superAdminFieldAccess: FieldAccess = ({ req }) => isSuperAdmin(req.user)

// Admin convenience: a setting group/field is shown only to super-admins or when the tenant's own
// settingsEntitlement enables it. UI conditions are NOT the security boundary —
// `enforceTenantSettingsEntitlement` enforces the same rule server-side.
const groupIsVisible = (
  data: unknown,
  user: unknown,
  group: TenantSettingGroup,
): boolean =>
  isSuperAdmin(user as UserLike | null) || entitlementIncludes(
    (data as { settingsEntitlement?: unknown } | null)?.settingsEntitlement,
    group,
  )

const assignedTenantAccess: NonNullable<CollectionConfig['access']>['update'] = ({ req }) => {
  if (isSuperAdmin(req.user)) return true
  if (!isTenantAdmin(req.user)) return false

  const tenantIDs = getUserTenantIDs(req.user)
  return tenantIDs.length > 0 ? { id: { in: tenantIDs } } : false
}

export const Tenants: CollectionConfig = {
  slug: 'tenants',
  labels: {
    singular: { ar: 'إعدادات الجهة', en: 'Entity settings' },
    plural: { ar: 'إعدادات الجهات', en: 'Entity settings' },
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'type', 'slug'],
    group: { ar: 'الإعدادات', en: 'Settings' },
  },
  access: {
    // The public site resolves a tenant by host/slug without authentication. In the admin/API,
    // authenticated non-super users are restricted to their explicitly assigned tenants.
    read: ({ req }) => {
      if (!req.user || isSuperAdmin(req.user)) return true

      const tenantIDs = getUserTenantIDs(req.user)
      return tenantIDs.length > 0 ? { id: { in: tenantIDs } } : false
    },
    create: ({ req }) => isSuperAdmin(req.user),
    update: assignedTenantAccess,
    delete: ({ req }) => isSuperAdmin(req.user),
  },
  hooks: {
    // Enforces, server-side, that a non-super admin edits only assigned tenants and only the
    // setting groups enabled by that tenant's `settingsEntitlement`. Throws 403 on violations.
    beforeChange: [enforceTenantSettingsEntitlement],
  },
  fields: [
    { name: 'name', type: 'text', required: true, localized: true,
      label: { ar: 'الاسم', en: 'Name' },
      admin: { condition: (data, _sibling, { user }) => groupIsVisible(data, user, 'general') } },
    { name: 'slug', type: 'text', required: true, unique: true,
      label: { ar: 'المعرّف', en: 'Slug' },
      access: { update: superAdminFieldAccess },
      admin: { description: 'Lowercase, hyphenated. Used by TENANT_SLUG and as a stable key.' } },
    { name: 'type', type: 'select', required: true, defaultValue: 'hospital',
      label: { ar: 'النوع', en: 'Type' },
      access: { update: superAdminFieldAccess },
      options: [
        { value: 'hospital', label: { ar: 'مستشفى', en: 'Hospital' } },
        { value: 'clinic', label: { ar: 'عيادة', en: 'Clinic' } },
      ] },
    { name: 'domains', type: 'text', hasMany: true,
      label: { ar: 'النطاقات', en: 'Domains' },
      access: { update: superAdminFieldAccess },
      admin: { description: 'Hostnames that map to this tenant, e.g. dgh.bitrail.dev, localhost.' } },
    { name: 'features', type: 'select', hasMany: true, options: TENANT_FEATURES,
      label: { ar: 'القدرات', en: 'Capabilities' },
      access: { update: superAdminFieldAccess },
      admin: { description: 'Controls public sections and the related Payload admin collections.' } },
    // Which tenant setting groups a non-super admin may edit for this tenant. Separate from
    // `features` (public/content modules) — governs only editable tenant settings. Defaults to all
    // groups for new/existing tenants; a super-admin may restrict it.
    { name: 'settingsEntitlement', type: 'select', hasMany: true,
      options: TENANT_SETTING_GROUPS,
      defaultValue: ALL_TENANT_SETTING_GROUPS,
      label: { ar: 'صلاحيات الإعدادات', en: 'Editable settings' },
      access: { update: superAdminFieldAccess },
      admin: {
        position: 'sidebar',
        description: 'Tenant setting groups this tenant administrator may edit. Platform-managed.',
        condition: (_data, _sibling, { user }) => isSuperAdmin(user as UserLike | null),
      } },
    {
      name: 'branding',
      type: 'group',
      label: { ar: 'الهوية', en: 'Branding' },
      admin: { condition: (data, _sibling, { user }) => groupIsVisible(data, user, 'branding') },
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
      admin: { condition: (data, _sibling, { user }) => groupIsVisible(data, user, 'hero') },
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
      admin: { condition: (data, _sibling, { user }) => groupIsVisible(data, user, 'contact') },
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
