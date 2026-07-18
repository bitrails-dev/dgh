import type { CollectionConfig } from 'payload'

// Catalog product. Tenant-scoped + commerce-gated. `price` is integer minor units in the tenant's
// currency; the checkout orchestration resolves it server-side (never trusting client prices) and
// pairs it with `taxBps` for the quote. `sku` is unique per tenant (compound index in the migration).
// `variants` (JSON array of {sku,name,price,compareAtPrice?,taxBps?}) adds per-variant pricing: a
// variant's `sku` is what keys `inventory-levels` and what `checkout` resolves (commerce/store/shared
// indexes base + variant skus together). `images` is a JSON array of media document IDs the storefront
// resolves to URLs. Categories/brands layer on later.
const STATUS = ['active', 'draft', 'archived'] as const
const KIND = ['physical', 'digital', 'service'] as const
const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: { en: v, ar: v } }))

export const Products: CollectionConfig = {
  slug: 'products',
  labels: {
    singular: { ar: 'منتج', en: 'Product' },
    plural: { ar: 'المنتجات', en: 'Products' },
  },
  admin: {
    group: { ar: 'المتجر', en: 'Commerce' },
    useAsTitle: 'name',
    defaultColumns: ['name', 'sku', 'price', 'status', 'productKind'],
  },
  fields: [
    { name: 'name', type: 'text', required: true, label: { ar: 'الاسم', en: 'Name' } },
    { name: 'slug', type: 'text', label: { ar: 'المعرّف', en: 'Slug' } },
    { name: 'sku', type: 'text', required: true, index: true, label: { ar: 'رمز الصنف', en: 'SKU' } },
    { name: 'description', type: 'textarea', label: { ar: 'الوصف', en: 'Description' } },
    { name: 'price', type: 'number', required: true, label: { ar: 'السعر', en: 'Price' }, admin: { description: 'Integer minor units.' } },
    { name: 'compareAtPrice', type: 'number', label: { ar: 'السعر قبل الخصم', en: 'Compare-at price' } },
    { name: 'taxClass', type: 'text', defaultValue: 'standard', label: { ar: 'فئة الضريبة', en: 'Tax class' } },
    { name: 'taxBps', type: 'number', defaultValue: 0, label: { ar: 'نسبة الضريبة', en: 'Tax (bps)' } },
    { name: 'status', type: 'select', defaultValue: 'active', options: opts(STATUS), label: { ar: 'الحالة', en: 'Status' } },
    { name: 'productKind', type: 'select', defaultValue: 'physical', options: opts(KIND), label: { ar: 'النوع', en: 'Kind' } },
    { name: 'trackInventory', type: 'checkbox', defaultValue: true, label: { ar: 'تتبع المخزون', en: 'Track inventory' } },
    // ponytail: images + variants stored as JSON (single text column each, matches carts.items
    // precedent) to keep migrations trivial; upgrade to typed array fields later for nicer admin UX.
    { name: 'images', type: 'json', label: { ar: 'الصور', en: 'Images' }, admin: { description: 'JSON array of media document IDs.' } },
    {
      name: 'variants', type: 'json', label: { ar: 'الخيارات', en: 'Variants' },
      admin: { description: 'JSON array: [{ sku, name, price, compareAtPrice?, taxBps? }]. A variant sku keys inventory.' },
    },
  ],
}
