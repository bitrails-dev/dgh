import type { CollectionBeforeChangeHook, CollectionConfig, FieldAccess } from 'payload'
import { getUserTenantIDs, isSuperAdmin, isTenantAdmin } from '../access/userAccess'
import type { UserLike } from '../access/userAccess'
import {
  ALL_TENANT_SETTING_GROUPS,
  TENANT_SETTING_GROUPS,
  enforceTenantSettingsEntitlement,
  entitlementIncludes,
} from '../access/tenantSettings'
import type { TenantSettingGroup } from '../access/tenantSettings'
import type { Tenant } from '../payload-types'
import { TENANT_FEATURES } from './tenantFeatures'
import { ALL_PLATFORMS, PLATFORMS, hasOAuth, platformLabel, platformMeta } from '../social/platforms'

// The eight public-feed social platforms. A tenant links a profile URL per platform under
// `contact.social`, and may opt each platform into auto-publishing under `socialPublishing`.
// WhatsApp is a contact channel only (no public feed), so it is NOT a publishing platform.
// Keep these keys in sync with the frontend social normalizer (src/lib/tenant.ts).
// Derived from the single platform catalogue (src/social/platforms.ts) so the contact.social URL
// fields and the includedPlatforms select share one source of truth with the frontend normalizer
// (src/lib/tenant.ts; parity asserted in tests). Keys intentionally stay in sync with it.
export const SOCIAL_PLATFORMS = PLATFORMS.map((p) => ({
  key: p.key,
  label: { ar: p.labelAr, en: p.label },
}))

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]['key']

// A tenant is an "entity" — e.g. a hospital or a clinic. The public site resolves one per request
// (by hostname / TENANT_SLUG) and every content collection is scoped to it via the multi-tenant
// plugin. `features` gates both public-site sections/routes and related Payload collections.
// Extend the feature catalogue in tenantFeatures.ts for a new gated capability.
//
// `type` is a relationship to the extensible `tenant-types` collection. Each Tenant Type carries a
// `defaultFeatures` template copied into a new Tenant only when its `features` value is omitted.
// Changing a Tenant's type never silently overwrites its customized features; a super-admin can
// explicitly reset them via the /reset-features-to-type-defaults endpoint.

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

const relationID = (relation: unknown): string | null => {
  if (relation === null || relation === undefined) return null
  if (typeof relation === 'number' || typeof relation === 'string') return String(relation)
  if (typeof relation === 'object' && 'id' in relation) {
    const id = (relation as { id?: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return String(id)
  }
  return null
}

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

// On create, when `features` is omitted (undefined), seed it from the selected Tenant Type's
// `defaultFeatures` template. An explicit empty array `[]` is intentional and preserved; any
// non-empty explicit value is never overwritten. Type *changes* (update) never touch features —
// only this create-time copy and the explicit super-admin reset endpoint do.
//
// Collection create access is super-admin-only, and trusted Local API creates pass overrideAccess,
// so reading the type template here does not open an access bypass for ordinary users: they cannot
// reach a create in the first place. The lookup carries `req` to honor the trusted create path.
//
// A selected, required type that cannot be resolved must fail closed — the create is aborted rather
// than silently producing a tenant without its template. No catch-all fallback: omitted features
// deterministically copy the current template, including an intentionally empty template.
const copyTypeDefaultFeatures: CollectionBeforeChangeHook = async ({
  data,
  operation,
  req,
}) => {
  if (operation !== 'create') return data

  const incoming = data as Record<string, unknown>
  // Respect an explicitly submitted features value — including an intentionally empty `[]`.
  if (incoming.features !== undefined) return data

  const typeId = relationID(incoming.type)
  // No type selected: leave features unset; the required-relationship validation surfaces that.
  if (!typeId) return data

  const tenantType = await req.payload.findByID({
    collection: 'tenant-types',
    id: typeId,
    depth: 0,
    overrideAccess: true,
    req,
    select: { defaultFeatures: true },
  }) as { defaultFeatures?: string[] | null } | null

  // Clone so the Tenant owns its own feature set, decoupled from future template edits. A missing
  // or empty template yields an explicit empty array (an intentionally empty template is valid).
  const defaults = tenantType?.defaultFeatures
  incoming.features = Array.isArray(defaults) ? defaults.map((feature) => feature) : []

  return data
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
    beforeChange: [enforceTenantSettingsEntitlement, copyTypeDefaultFeatures],
  },
  endpoints: [
    // POST /api/tenants/:id/reset-features-to-type-defaults
    // Super-admin only. Loads the Tenant's current type and replaces its features with a clone of
    // that type's current default template (including an intentionally empty template). Returns the
    // updated features and the type identity. Never exposed to tenant admins.
    {
      path: '/:id/reset-features-to-type-defaults',
      method: 'post',
      handler: async (req) => {
        if (!req.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        if (!isSuperAdmin(req.user as UserLike)) {
          return Response.json({ error: 'Only platform super-admins can reset entity features.' }, { status: 403 })
        }

        const id = req.routeParams?.id as string | undefined
        if (!id) {
          return Response.json({ error: 'A tenant id is required.' }, { status: 400 })
        }

        // Resolve the Tenant's current type id. Load only what we need; depth:0 keeps the
        // relationship as a scalar id so we can branch on missing-type explicitly below.
        const tenant = await req.payload.findByID({
          collection: 'tenants',
          id,
          depth: 0,
          overrideAccess: true,
          req,
          select: { type: true },
        }).catch(() => null) as { type?: number | string | { id?: number | string } | null } | null

        if (!tenant) {
          return Response.json({ error: 'Tenant not found.' }, { status: 404 })
        }

        const typeId = relationID(tenant.type)
        if (!typeId) {
          return Response.json({ error: 'This tenant has no type assigned.' }, { status: 400 })
        }

        // Explicitly load the assigned Tenant Type to use its *actual* current template. We never
        // infer an empty template from a scalar/unpopulated relationship or a missing field — a
        // lookup failure returns a clear error and must not erase the Tenant's features.
        const tenantType = await req.payload.findByID({
          collection: 'tenant-types',
          id: typeId,
          depth: 0,
          overrideAccess: true,
          req,
          select: { defaultFeatures: true, slug: true },
        }).catch(() => null) as { defaultFeatures?: string[] | null; slug?: string | null } | null

        if (!tenantType) {
          return Response.json({ error: 'The assigned tenant type could not be loaded.' }, { status: 404 })
        }

        const template = tenantType.defaultFeatures ?? []
        const features = Array.isArray(template) ? template.map((feature) => feature) : []

        const updated = await req.payload.update({
          collection: 'tenants',
          id,
          // The template values are validated select options; cast satisfies the strict update type.
          data: { features: features as Tenant['features'] },
          overrideAccess: true,
          req,
        }) as { features?: string[] | null }

        return Response.json({
          features: updated.features ?? features,
          typeId,
          typeSlug: tenantType.slug ?? null,
        })
      },
    },
    // GET /api/tenants/:id/social-status
    // Sanitized per-platform connection + last-publish status for the connection panel. No tokens.
    // Authorized for the super-admin or an admin assigned to this tenant.
    {
      path: '/:id/social-status',
      method: 'get',
      handler: async (req) => {
        if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        const id = req.routeParams?.id as string | undefined
        if (!id) return Response.json({ error: 'A tenant id is required.' }, { status: 400 })
        if (!isSuperAdmin(req.user as UserLike) && !getUserTenantIDs(req.user).map(String).includes(String(id))) {
          return Response.json({ error: 'Forbidden.' }, { status: 403 })
        }
        const conns = await req.payload.find({
          collection: 'social-connections',
          where: { tenant: { equals: id } },
          overrideAccess: true,
          req,
          limit: 100,
        })
        const byPlatform = new Map(conns.docs.map((c) => [c.platform, c] as const))
        // Latest failed publication per platform, so the connection panel can offer an explicit retry
        // of that record. The connection row itself carries no article id; this maps platform → the
        // most recent failed article. Bounded + best-effort.
        const failed = await req.payload.find({
          collection: 'social-publications',
          where: { and: [{ tenant: { equals: id } }, { status: { equals: 'failed' } }] },
          overrideAccess: true, req, limit: 100, sort: '-updatedAt',
        })
        const lastFailedArticleByPlatform = new Map<string, number | string>()
        for (const pub of failed.docs) {
          const fp = (pub as { platform?: string; article?: number | string }).platform
          if (fp && !lastFailedArticleByPlatform.has(fp)) lastFailedArticleByPlatform.set(fp, (pub as { article?: number | string }).article ?? '')
        }
        // Every catalogue platform appears exactly once, with its label + availability derived from
        // the single platform table (no duplicated label map in the client). Tier-2 platforms surface
        // as not connectable with their precise approval note.
        return Response.json({
          platforms: ALL_PLATFORMS.map((p) => {
            const c = byPlatform.get(p) as
              | { status?: string; remoteAccountLabel?: string; lastPublishStatus?: string; lastPublishUrl?: string; lastPublishAt?: string; lastErrorCode?: string }
              | undefined
            return {
              platform: p,
              label: platformLabel(p, 'en'),
              available: hasOAuth(p),
              approvalNote: platformMeta(p)?.approvalNote ?? '',
              connected: !!c && c.status === 'connected',
              status: c?.status ?? 'not_connected',
              remoteAccountLabel: c?.remoteAccountLabel ?? '',
              lastPublishStatus: c?.lastPublishStatus ?? '',
              lastPublishUrl: c?.lastPublishUrl ?? '',
              lastPublishAt: c?.lastPublishAt ?? '',
              lastErrorCode: c?.lastErrorCode ?? '',
              lastFailedArticleId: lastFailedArticleByPlatform.get(p) ?? '',
            }
          }),
        })
      },
    },
  ],
  fields: [
    { name: 'name', type: 'text', required: true, localized: true,
      label: { ar: 'الاسم', en: 'Name' },
      admin: { condition: (data, _sibling, { user }) => groupIsVisible(data, user, 'general') } },
    { name: 'slug', type: 'text', required: true, unique: true,
      label: { ar: 'المعرّف', en: 'Slug' },
      access: { update: superAdminFieldAccess },
      admin: { description: 'Lowercase, hyphenated. Used by TENANT_SLUG and as a stable key.' } },
    // Relationship to the extensible `tenant-types` collection. A super-admin can create a Tenant
    // Type inline from this field. Assignment/update is super-admin-only (platform-managed).
    { name: 'type', type: 'relationship', relationTo: 'tenant-types', required: true,
      label: { ar: 'النوع', en: 'Type' },
      access: { update: superAdminFieldAccess },
      admin: { description: 'Entity type. Drives the default feature template copied into new entities.' } },
    // UI-only: when a super-admin selects/changes the `type`, live-apply that type's `defaultFeatures`
    // template to `features` (Capabilities). Renders and stores nothing — the component reads `type`
    // and writes `features`. Super-admin-gated (both fields are super-admin-update-only).
    { name: 'applyTypeTemplate', type: 'ui',
      admin: { components: { Field: '/src/admin/ApplyTypeTemplate#default' },
        condition: (_data, _sibling, { user }) => isSuperAdmin(user as UserLike | null) } },
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
          // One optional profile URL per platform. Empty is allowed; a non-empty value must be a
          // valid http(s) URL. Existing facebook/x/youtube values keep their column names.
          fields: SOCIAL_PLATFORMS.map(({ key, label }) => ({
            name: `${key}Url`,
            type: 'text' as const,
            label,
            validate: (value: unknown) => {
              if (value === undefined || value === null || value === '') return true
              return /^https?:\/\//i.test(String(value)) || 'Enter a valid http(s) URL.'
            },
          })),
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
    // Tenant-controlled social auto-publishing. Gated by the `socialPublishing` setting
    // entitlement (a platform operator may withhold it). `enabled` is the master switch;
    // `defaultAutoPublish` is the default applied to newly created Articles when they omit it;
    // `includedPlatforms` selects which of the eight platforms each auto-published Article is sent
    // to. WhatsApp is intentionally absent (contact channel, not a public feed). Per-platform
    // OAuth connections live in a separate collection (Task E) and are joined in the publishing UI.
    {
      name: 'socialPublishing',
      type: 'group',
      label: { ar: 'النشر التلقائي على وسائل التواصل', en: 'Social auto-publishing' },
      admin: { condition: (data, _sibling, { user }) => groupIsVisible(data, user, 'socialPublishing') },
      fields: [
        {
          name: 'enabled',
          type: 'checkbox',
          defaultValue: false,
          label: { ar: 'تفعيل النشر التلقائي', en: 'Enable auto-publishing' },
          admin: {
            description:
              'Master switch. When off, no Article is auto-published regardless of per-platform toggles.',
          },
        },
        {
          name: 'defaultAutoPublish',
          type: 'checkbox',
          defaultValue: false,
          label: { ar: 'النشر التلقائي للمقالات الجديدة افتراضيًا', en: 'Auto-publish new Articles by default' },
        },
        {
          name: 'includedPlatforms',
          type: 'select',
          hasMany: true,
          options: SOCIAL_PLATFORMS.map(({ key, label }) => ({ value: key, label })),
          label: { ar: 'المنصات المشمولة', en: 'Included platforms' },
          admin: {
            description:
              'Platforms each auto-published Article is sent to. Connect each platform in the publishing panel (requires platform app configuration / approval).',
          },
        },
      ],
    },
    // Super-admin-only reset control on existing documents. Confirms, calls the reset endpoint,
    // surfaces success/error, and reloads the document so stored state is visible. Hidden from
    // tenant admins and on the create form (no id yet).
    {
      name: 'resetFeatures',
      type: 'ui',
      label: { ar: 'إعادة الضبط', en: 'Reset' },
      admin: {
        components: { Field: '/src/admin/ResetTenantFeatures#default' },
        condition: (_data, _sibling, { user }) => isSuperAdmin(user as UserLike | null),
      },
    },
    // Social connection panel: per-platform Connect/Disconnect + last result. Shown only when the
    // socialPublishing group is visible (super-admin or entitled tenant admin), on existing docs.
    {
      name: 'socialConnections',
      type: 'ui',
      label: { ar: 'اتصالات التواصل', en: 'Social connections' },
      admin: {
        components: { Field: '/src/admin/SocialConnectionsPanel#default' },
        condition: (data, _sibling, { user }) => groupIsVisible(data, user, 'socialPublishing'),
      },
    },
  ],
}
