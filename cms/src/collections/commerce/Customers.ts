import type { CollectionBeforeChangeHook, CollectionConfig, FieldAccess } from 'payload'
import { normalizeEmail } from '../../commerce/customers/auth'

// Tenant-local customer account. NOT a Payload auth collection: tenant-local identity (the same email
// may belong to different customers in different tenants) doesn't fit Payload's global auth model, so
// login/register are custom /api/store routes using commerce/customers/auth (scrypt + sessions/OTP).
// Credentials are write-only (field read = false); the unique identity is the SERVER-normalized email
// (compound unique tenant + normalizedEmail) so case/spacing can't create duplicate accounts.
const STATUS = ['active', 'disabled'] as const
const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: { en: v, ar: v } }))
const secretReadOnly: FieldAccess = () => false

const normalizeEmailHook: CollectionBeforeChangeHook = ({ data }) => {
  if (data && typeof data.email === 'string') {
    data.normalizedEmail = normalizeEmail(data.email) ?? data.email.toLowerCase().trim()
  }
  return data
}

export const Customers: CollectionConfig = {
  slug: 'customers',
  labels: {
    singular: { ar: 'عميل', en: 'Customer' },
    plural: { ar: 'العملاء', en: 'Customers' },
  },
  admin: {
    group: { ar: 'المتجر', en: 'Commerce' },
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'verified', 'status'],
  },
  hooks: { beforeChange: [normalizeEmailHook] },
  fields: [
    { name: 'email', type: 'email', required: true, label: { ar: 'البريد', en: 'Email' } },
    { name: 'normalizedEmail', type: 'text', label: { ar: 'بريد معدل', en: 'Normalized email' }, admin: { readOnly: true } },
    { name: 'name', type: 'text', label: { ar: 'الاسم', en: 'Name' } },
    { name: 'phone', type: 'text', label: { ar: 'الهاتف', en: 'Phone' } },
    { name: 'passwordHash', type: 'text', access: { read: secretReadOnly }, label: { ar: 'هاش كلمة المرور', en: 'Password hash' } },
    { name: 'passwordSalt', type: 'text', access: { read: secretReadOnly }, label: { ar: 'ملح كلمة المرور', en: 'Password salt' } },
    { name: 'verified', type: 'checkbox', defaultValue: false, label: { ar: 'موثق', en: 'Verified' } },
    { name: 'verificationTokenHash', type: 'text', access: { read: secretReadOnly }, label: { ar: 'هاش التوثيق', en: 'Verification token hash' } },
    { name: 'resetTokenHash', type: 'text', access: { read: secretReadOnly }, label: { ar: 'هاش إعادة التعيين', en: 'Reset token hash' } },
    { name: 'status', type: 'select', defaultValue: 'active', options: opts(STATUS), label: { ar: 'الحالة', en: 'Status' } },
  ],
}
