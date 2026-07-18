import type { CollectionConfig } from 'payload'

// Movement types. reserve/commit/release act on the reserved counter; receive/adjust/damage/count
// act on onHand; transfer_out/transfer_in move stock between locations.
export const STOCK_MOVEMENT_TYPES = [
  'receive', 'adjust', 'damage', 'count',
  'reserve', 'commit', 'release',
  'transfer_out', 'transfer_in',
] as const
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number]

const systemOnly = () => false

// Immutable stock ledger. Append-only: create/update/delete are blocked through the API; only the
// inventory module writes rows via overrideAccess. Each row carries the resulting on-hand snapshot
// so the full history reconstructs every level without re-deriving from deltas.
export const StockMovements: CollectionConfig = {
  slug: 'stock-movements',
  labels: {
    singular: { ar: 'حركة مخزون', en: 'Stock movement' },
    plural: { ar: 'حركات المخزون', en: 'Stock movements' },
  },
  admin: {
    group: { ar: 'المتجر', en: 'Commerce' },
    useAsTitle: 'type',
    defaultColumns: ['type', 'level', 'quantity', 'createdAt'],
  },
  access: { create: systemOnly, update: systemOnly, delete: systemOnly },
  fields: [
    { name: 'level', type: 'relationship', relationTo: 'inventory-levels', required: true, label: { ar: 'الرصيد', en: 'Level' } },
    {
      name: 'type', type: 'select', required: true,
      options: STOCK_MOVEMENT_TYPES.map((v) => ({ value: v, label: { en: v, ar: v } })),
      label: { ar: 'النوع', en: 'Type' },
    },
    { name: 'quantity', type: 'number', required: true, label: { ar: 'الكمية', en: 'Quantity (signed)' }, admin: { description: 'Signed delta against the relevant counter.' } },
    { name: 'resultingOnHand', type: 'number', label: { ar: 'الرصيد الناتج', en: 'Resulting on-hand' } },
    { name: 'reason', type: 'text', label: { ar: 'السبب', en: 'Reason' } },
    { name: 'orderRef', type: 'text', label: { ar: 'مرجع الطلب', en: 'Order reference' } },
    { name: 'reservation', type: 'relationship', relationTo: 'stock-reservations', label: { ar: 'الحجز', en: 'Reservation' } },
    { name: 'transfer', type: 'relationship', relationTo: 'inventory-transfers', label: { ar: 'التحويل', en: 'Transfer' } },
    { name: 'actor', type: 'text', label: { ar: 'المستخدم', en: 'Actor' } },
    { name: 'metadata', type: 'text', label: { ar: 'بيانات إضافية', en: 'Metadata (JSON)' } },
  ],
}
