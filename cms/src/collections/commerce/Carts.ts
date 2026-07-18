import type { CollectionConfig } from 'payload'

// Shopper cart. Tenant-scoped + commerce-gated. `cartToken` is the stable anonymous id (cookie) that
// also keys inventory reservations. `items` is a JSON snapshot the storefront mutates; the server
// re-prices from the catalog at checkout (never trusts stored/client prices). compound unique on
// tenant + cartToken in the migration.
const STATUS = ['active', 'abandoned', 'converted'] as const
const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: { en: v, ar: v } }))

export const Carts: CollectionConfig = {
  slug: 'carts',
  labels: {
    singular: { ar: 'سلة', en: 'Cart' },
    plural: { ar: 'السلال', en: 'Carts' },
  },
  admin: {
    group: { ar: 'المتجر', en: 'Commerce' },
    useAsTitle: 'cartToken',
    defaultColumns: ['cartToken', 'customerEmail', 'status', 'updatedAt'],
  },
  fields: [
    { name: 'cartToken', type: 'text', required: true, index: true, label: { ar: 'رمز السلة', en: 'Cart token' } },
    { name: 'customer', type: 'relationship', relationTo: 'customers', label: { ar: 'العميل', en: 'Customer' } },
    { name: 'customerEmail', type: 'text', index: true, label: { ar: 'بريد العميل', en: 'Customer email' } },
    { name: 'items', type: 'json', label: { ar: 'البنود', en: 'Items' }, admin: { description: 'Client-mutable snapshot; re-priced server-side at checkout.' } },
    { name: 'currency', type: 'text', label: { ar: 'العملة', en: 'Currency' } },
    { name: 'status', type: 'select', defaultValue: 'active', options: opts(STATUS), label: { ar: 'الحالة', en: 'Status' } },
    { name: 'expiresAt', type: 'date', label: { ar: 'تنتهي في', en: 'Expires at' } },
  ],
}
