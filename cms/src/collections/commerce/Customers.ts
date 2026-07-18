import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'
import { normalizeEmail } from '../../commerce/customers/auth'

// Tenant-aware customer account as a Payload auth collection (plugin-first plan §3.6). Tenant-local
// identity is encoded in the server-derived username `<tenantNumericId>:<normalizedEmail>` — globally
// unique (Payload requires a unique username) but tenant-scoped by construction. The browser never
// sends or receives the username; `loginWithUsername` requires email + username, and a beforeChange
// hook derives the username server-side. Payload owns password hashing, verification and sessions
// (hash / salt / _verified / _verificationToken / sessions) — the legacy scrypt + stateless-session
// cryptography is removed (F2 deletes the last helpers). Tenant, username and email are immutable in
// the v1 self-service profile.
const STATUS = ['active', 'disabled'] as const
const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: { en: v, ar: v } }))

const normalized = (email: string): string => normalizeEmail(email) ?? email.toLowerCase().trim()

// Server-derived username `<tenantNumericId>:<normalizedEmail>`. Runs on create before the write so
// the unique-username constraint is satisfied without the browser ever supplying one.
const usernameHook: CollectionBeforeChangeHook = ({ data }) => {
  if (data && data.tenant != null) {
    const tid =
      typeof data.tenant === 'object' && data.tenant !== null
        ? (data.tenant as { id?: number | string }).id
        : (data.tenant as number | string)
    const email = typeof data.email === 'string' ? normalized(data.email) : ''
    if (tid != null && email) data.username = `${tid}:${email}`
  }
  return data
}

const normalizeEmailHook: CollectionBeforeChangeHook = ({ data }) => {
  if (data && typeof data.email === 'string') {
    data.normalizedEmail = normalized(data.email)
  }
  return data
}

export const Customers: CollectionConfig = {
  slug: 'customers',
  auth: {
    useSessions: true,
    tokenExpiration: 604800,
    maxLoginAttempts: 5,
    lockTime: 900000,
    verify: true,
    removeTokenFromResponses: false,
    loginWithUsername: {
      allowedFields: ['email'],
      requireEmail: true,
      requireUsername: true,
    },
  } as unknown as CollectionConfig['auth'],
  labels: {
    singular: { ar: 'عميل', en: 'Customer' },
    plural: { ar: 'العملاء', en: 'Customers' },
  },
  admin: {
    group: { ar: 'المتجر', en: 'Commerce' },
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'status'],
  },
  hooks: { beforeChange: [normalizeEmailHook, usernameHook] },
  fields: [
    { name: 'email', type: 'email', required: true, label: { ar: 'البريد', en: 'Email' } },
    {
      name: 'normalizedEmail',
      type: 'text',
      label: { ar: 'بريد معدل', en: 'Normalized email' },
      admin: { readOnly: true },
    },
    { name: 'name', type: 'text', label: { ar: 'الاسم', en: 'Name' } },
    { name: 'phone', type: 'text', label: { ar: 'الهاتف', en: 'Phone' } },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'active',
      options: opts(STATUS),
      label: { ar: 'الحالة', en: 'Status' },
    },
  ],
}
