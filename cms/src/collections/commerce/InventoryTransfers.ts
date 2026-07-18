import type { CollectionConfig } from 'payload'

export const TRANSFER_STATUSES = ['draft', 'dispatched', 'received', 'cancelled'] as const
export type TransferStatus = (typeof TRANSFER_STATUSES)[number]

const systemOnly = () => false

// Stock movement between two locations of the same tenant. Dispatch emits a transfer_out movement
// (on_hand down at the source); receipt emits a transfer_in movement (on_hand up at the destination)
// and links both movement rows. Single-line per row (sku + quantity); created and advanced only by
// the inventory module, so update/delete are API-blocked.
export const InventoryTransfers: CollectionConfig = {
  slug: 'inventory-transfers',
  labels: {
    singular: { ar: 'تحويل مخزون', en: 'Inventory transfer' },
    plural: { ar: 'تحويلات المخزون', en: 'Inventory transfers' },
  },
  admin: {
    group: { ar: 'المتجر', en: 'Commerce' },
    useAsTitle: 'sku',
    defaultColumns: ['sku', 'fromLocation', 'toLocation', 'quantity', 'status'],
  },
  access: { update: systemOnly, delete: systemOnly },
  fields: [
    { name: 'fromLocation', type: 'relationship', relationTo: 'inventory-locations', required: true, label: { ar: 'من موقع', en: 'From' } },
    { name: 'toLocation', type: 'relationship', relationTo: 'inventory-locations', required: true, label: { ar: 'إلى موقع', en: 'To' } },
    { name: 'sku', type: 'text', required: true, label: { ar: 'رمز الصنف', en: 'SKU' } },
    { name: 'quantity', type: 'number', required: true, label: { ar: 'الكمية', en: 'Quantity' } },
    {
      name: 'status', type: 'select', required: true, defaultValue: 'draft',
      options: TRANSFER_STATUSES.map((v) => ({ value: v, label: { en: v, ar: v } })),
      label: { ar: 'الحالة', en: 'Status' },
    },
    { name: 'dispatchMovement', type: 'relationship', relationTo: 'stock-movements', label: { ar: 'حركة الصرف', en: 'Dispatch movement' } },
    { name: 'receiveMovement', type: 'relationship', relationTo: 'stock-movements', label: { ar: 'حركة الاستلام', en: 'Receive movement' } },
    { name: 'note', type: 'textarea', label: { ar: 'ملاحظات', en: 'Note' } },
  ],
}
