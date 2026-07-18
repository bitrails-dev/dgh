import type { CollectionConfig } from 'payload'

export const RESERVATION_STATUSES = ['active', 'committed', 'released', 'expired'] as const
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number]

const systemOnly = () => false

// A temporary stock hold created when checkout starts (not when an item merely enters a cart).
// One row per (level, sku, cart). A partial unique index on (tenant, level, cart_token) WHERE
// status='active' (created in the migration) enforces a single active hold per cart+level — the
// inventory module relies on this for idempotent re-reserve. Default TTL is 15 minutes
// (commerce-settings will make it tenant-configurable).
export const StockReservations: CollectionConfig = {
  slug: 'stock-reservations',
  labels: {
    singular: { ar: 'حجز مخزون', en: 'Stock reservation' },
    plural: { ar: 'حجوزات المخزون', en: 'Stock reservations' },
  },
  admin: {
    group: { ar: 'المتجر', en: 'Commerce' },
    useAsTitle: 'cartToken',
    defaultColumns: ['cartToken', 'level', 'quantity', 'status', 'expiresAt'],
  },
  access: { create: systemOnly, update: systemOnly, delete: systemOnly },
  fields: [
    { name: 'level', type: 'relationship', relationTo: 'inventory-levels', required: true, label: { ar: 'الرصيد', en: 'Level' } },
    { name: 'sku', type: 'text', required: true, label: { ar: 'رمز الصنف', en: 'SKU' } },
    { name: 'quantity', type: 'number', required: true, label: { ar: 'الكمية', en: 'Quantity' } },
    { name: 'cartToken', type: 'text', required: true, index: true, label: { ar: 'رمز السلة', en: 'Cart token' } },
    {
      name: 'status', type: 'select', required: true, defaultValue: 'active',
      options: RESERVATION_STATUSES.map((v) => ({ value: v, label: { en: v, ar: v } })),
      label: { ar: 'الحالة', en: 'Status' },
    },
    { name: 'expiresAt', type: 'date', required: true, label: { ar: 'ينتهي في', en: 'Expires at' } },
    { name: 'orderRef', type: 'text', label: { ar: 'مرجع الطلب', en: 'Order reference' } },
    { name: 'source', type: 'text', label: { ar: 'المصدر', en: 'Source' } },
  ],
}
