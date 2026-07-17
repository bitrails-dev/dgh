// Shared tenant feature catalogue. The feature *keys* are code-defined because they gate
// public-site routes, Payload collections, and access policy (see tenantFeatureAccess.ts).
// Tenant *types* and their feature combinations are database-extensible (TenantTypes.ts) without
// a deployment, but the set of feature keys itself is not data-driven.
//
// The `value` of each option mirrors the frontend hasFeature() keys in src/lib/tenant.ts. Keep
// the two in sync.

export type TenantFeature =
  | 'departments'
  | 'team'
  | 'articles'
  | 'events'
  | 'awards'
  | 'achievements'
  | 'testimonials'
  | 'portal'

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
