import type { CollectionConfig, FieldAccess } from 'payload'

// One stock level per (tenant, location, SKU). The quantity counters (onHand/reserved/incoming/
// damaged) are cached values kept in lock-step with the immutable stock-movements ledger by the
// inventory module — they are NEVER edited directly. Field-level `access.update: () => false`
// makes the counters read-only through the API; only the module writes them, via overrideAccess.
// available = onHand - reserved (derived). product/variant relationships are added when the catalog
// collections land (this slice keys on SKU to stay independent of the ecommerce plugin).
const counterReadOnly: FieldAccess = () => false

export const InventoryLevels: CollectionConfig = {
  slug: 'inventory-levels',
  labels: {
    singular: { ar: 'رصيد مخزون', en: 'Inventory level' },
    plural: { ar: 'أرصدة المخزون', en: 'Inventory levels' },
  },
  admin: {
    group: { ar: 'المتجر', en: 'Commerce' },
    useAsTitle: 'sku',
    defaultColumns: ['sku', 'location', 'onHand', 'reserved', 'reorderPoint'],
  },
  fields: [
    { name: 'location', type: 'relationship', relationTo: 'inventory-locations', required: true, label: { ar: 'الموقع', en: 'Location' } },
    { name: 'sku', type: 'text', required: true, label: { ar: 'رمز الصنف', en: 'SKU' } },
    { name: 'variantSku', type: 'text', label: { ar: 'رمز الخامة', en: 'Variant SKU' } },
    { name: 'onHand', type: 'number', defaultValue: 0, access: { update: counterReadOnly }, label: { ar: 'المتوفر', en: 'On hand' } },
    { name: 'reserved', type: 'number', defaultValue: 0, access: { update: counterReadOnly }, label: { ar: 'محجوز', en: 'Reserved' } },
    { name: 'incoming', type: 'number', defaultValue: 0, access: { update: counterReadOnly }, label: { ar: 'وارد', en: 'Incoming' } },
    { name: 'damaged', type: 'number', defaultValue: 0, access: { update: counterReadOnly }, label: { ar: 'تالف', en: 'Damaged' } },
    { name: 'safetyStock', type: 'number', defaultValue: 0, label: { ar: 'مخزون الأمان', en: 'Safety stock' } },
    { name: 'reorderPoint', type: 'number', defaultValue: 0, label: { ar: 'نقطة إعادة الطلب', en: 'Reorder point' } },
    { name: 'lowStockThreshold', type: 'number', defaultValue: 0, label: { ar: 'حد التنبيه', en: 'Low-stock threshold' } },
    { name: 'bin', type: 'text', label: { ar: 'الموقع الداخلي', en: 'Bin' } },
  ],
}
