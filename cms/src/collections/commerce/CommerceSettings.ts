import type { CollectionBeforeChangeHook, CollectionConfig, Field, FieldAccess } from 'payload'
import { encryptGatewaySecret } from '../../commerce/crypto'

// Tenant-global commerce configuration. Exactly one document per tenant (a unique index on tenant_id
// is created in the migration). Holds currency, tax mode, reservation TTL, the enabled payment
// methods, and the encrypted gateway credentials. Gateway secrets are WRITE-ONLY: saved encrypted
// via the secret-field hook (beforeChange) and never returned by reads (field access.read = false).
// The webhook/checkout paths load them via overrideAccess and decrypt with commerce/crypto.
//
// Minimal-but-real for this pass: status, currency, tax mode, sandbox, reservation TTL, order prefix,
// Paymob + Kashier credentials, COD and bank-transfer rules. SMTP sender identity, locales, legal
// text, low-stock defaults and abandoned-cart settings are appended in a later migration.

const STATUS_OPTIONS = ['setup', 'live', 'maintenance', 'disabled'] as const

// A write-only secret. Encryption + preserve-on-empty happen in the collection-level handleSecrets
// hook (NOT a field hook): a field hook would re-encrypt the restored blob on update. Because the
// field is read-only (access.read = false), a client can only ever submit plaintext (new value) or
// empty (unchanged) — never a stored blob — so "non-empty ⇒ encrypt, empty ⇒ preserve" is safe.
const secretField = (name: string, ar: string, en: string): Field => ({
  name,
  type: 'text',
  label: { ar, en },
  access: { read: (() => false) as FieldAccess },
  admin: { description: 'Write-only. Stored encrypted (AES-256-GCM). Leave blank to keep the current value.' },
})

const SECRET_PATHS: ReadonlyArray<readonly [string, string]> = [
  ['paymob', 'apiKey'],
  ['paymob', 'hmacSecret'],
  ['kashier', 'apiKey'],
  ['kashier', 'webhookSecret'],
]

const handleSecrets: CollectionBeforeChangeHook = ({ data, operation, originalDoc }) => {
  for (const [group, field] of SECRET_PATHS) {
    const g = (data as any)?.[group]
    if (!g) continue
    const incoming = g[field]
    if (incoming === undefined || incoming === null || incoming === '') {
      // Unchanged: preserve the existing encrypted blob (update), or null (create).
      g[field] = operation === 'update' ? ((originalDoc as any)?.[group]?.[field] ?? null) : null
    } else {
      g[field] = encryptGatewaySecret(String(incoming))
    }
  }
  return data
}

// Enforce exactly one settings document per tenant: reject create if this tenant already has one.
const singlePerTenant: CollectionBeforeChangeHook = async ({ data, operation, req }) => {
  if (operation !== 'create') return data
  const tenantId = (data as { tenant?: { id?: number | string } | number | string }).tenant
  const tid = tenantId && typeof tenantId === 'object' ? tenantId.id : tenantId
  if (tid === undefined || tid === null) return data
  const { totalDocs } = await req.payload.count({
    collection: 'commerce-settings',
    where: { tenant: { equals: tid } },
    overrideAccess: true,
    req,
  })
  if (totalDocs > 0) {
    const { APIError } = await import('payload')
    throw new APIError('This tenant already has a commerce-settings document.', 400, null, true)
  }
  return data
}

export const CommerceSettings: CollectionConfig = {
  slug: 'commerce-settings',
  labels: {
    singular: { ar: 'إعدادات المتجر', en: 'Commerce settings' },
    plural: { ar: 'إعدادات المتجر', en: 'Commerce settings' },
  },
  admin: {
    group: { ar: 'المتجر', en: 'Commerce' },
    useAsTitle: 'status',
    defaultColumns: ['status', 'currency', 'taxMode', 'sandbox'],
  },
  hooks: { beforeChange: [handleSecrets, singlePerTenant] },
  fields: [
    { name: 'status', type: 'select', required: true, defaultValue: 'setup',
      options: STATUS_OPTIONS.map((v) => ({ value: v, label: { en: v, ar: v } })),
      label: { ar: 'الحالة', en: 'Status' } },
    { name: 'currency', type: 'text', required: true, defaultValue: 'EGP',
      validate: (v: unknown) => /^[A-Z]{3}$/.test(String(v)) || 'Enter a 3-letter ISO-4217 currency code.',
      label: { ar: 'العملة', en: 'Currency' } },
    { name: 'timezone', type: 'text', defaultValue: 'Africa/Cairo', label: { ar: 'المنطقة الزمنية', en: 'Timezone' } },
    { name: 'taxMode', type: 'select', required: true, defaultValue: 'exclusive',
      options: [{ value: 'exclusive', label: { en: 'Exclusive', ar: 'حصري' } }, { value: 'inclusive', label: { en: 'Inclusive', ar: 'شامل' } }],
      label: { ar: 'نظام الضريبة', en: 'Tax mode' } },
    { name: 'sandbox', type: 'checkbox', defaultValue: true,
      label: { ar: 'وضع التجربة', en: 'Sandbox' },
      admin: { description: 'Use gateway sandbox/test environment.' } },
    { name: 'reservationTtlMinutes', type: 'number', defaultValue: 15,
      label: { ar: 'مدة حجز المخزون (دقيقة)', en: 'Reservation TTL (minutes)' } },
    { name: 'orderNumberPrefix', type: 'text', defaultValue: 'ORD-',
      label: { ar: 'بادئة رقم الطلب', en: 'Order number prefix' } },
    // Per-tenant monotonic sequence counters, atomically incremented by commerce/orders/numbering.
    { name: 'orderNumberSeq', type: 'number', defaultValue: 0, access: { update: () => false }, label: { ar: 'متسلسل رقم الطلب', en: 'Order number sequence' } },
    { name: 'invoiceNumberSeq', type: 'number', defaultValue: 0, access: { update: () => false }, label: { ar: 'متسلسل رقم الفاتورة', en: 'Invoice number sequence' } },

    {
      name: 'paymob', type: 'group', label: { ar: 'Paymob', en: 'Paymob' },
      fields: [
        { name: 'enabled', type: 'checkbox', defaultValue: false, label: { ar: 'مفعّل', en: 'Enabled' } },
        { name: 'merchantId', type: 'text', label: { ar: 'معرّف التاجر', en: 'Merchant ID' } },
        { name: 'iframeId', type: 'text', label: { ar: 'معرّف الإطار', en: 'Iframe ID' } },
        { name: 'integrationId', type: 'text', label: { ar: 'معرّف التكامل', en: 'Integration ID' }, admin: { description: 'Paymob online integration id (required by the payment-key step).' } },
        secretField('apiKey', 'مفتاح API', 'API key'),
        secretField('hmacSecret', 'سر HMAC', 'HMAC secret'),
      ],
    },
    {
      name: 'kashier', type: 'group', label: { ar: 'Kashier', en: 'Kashier' },
      fields: [
        { name: 'enabled', type: 'checkbox', defaultValue: false, label: { ar: 'مفعّل', en: 'Enabled' } },
        { name: 'merchantId', type: 'text', label: { ar: 'معرّف التاجر', en: 'Merchant ID' } },
        secretField('apiKey', 'مفتاح API', 'API key'),
        secretField('webhookSecret', 'سر الويب هوك', 'Webhook secret'),
      ],
    },
    {
      name: 'cod', type: 'group', label: { ar: 'الدفع عند الاستلام', en: 'Cash on delivery' },
      fields: [
        { name: 'enabled', type: 'checkbox', defaultValue: false, label: { ar: 'مفعّل', en: 'Enabled' } },
        { name: 'minSubtotal', type: 'number', label: { ar: 'الحد الأدنى', en: 'Minimum subtotal' } },
        { name: 'fee', type: 'number', defaultValue: 0, label: { ar: 'رسوم', en: 'Fee' } },
      ],
    },
    {
      name: 'bankTransfer', type: 'group', label: { ar: 'تحويل بنكي', en: 'Bank transfer' },
      fields: [
        { name: 'enabled', type: 'checkbox', defaultValue: false, label: { ar: 'مفعّل', en: 'Enabled' } },
        { name: 'instructions', type: 'textarea', label: { ar: 'التعليمات', en: 'Instructions' } },
        { name: 'accountDetails', type: 'text', label: { ar: 'تفاصيل الحساب', en: 'Account details' } },
      ],
    },
  ],
}
