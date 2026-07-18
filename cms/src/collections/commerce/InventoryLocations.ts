import type { CollectionConfig } from 'payload'

// A physical stock location (warehouse, store, clinic branch). Tenant-scoped + commerce-gated via
// the multi-tenant plugin and the tenant feature policy map. Inventory levels belong to a location
// and fulfillment is allocated per-location. Fields are flat (no nested groups) so the migration is
// a simple flat table.
export const InventoryLocations: CollectionConfig = {
  slug: 'inventory-locations',
  labels: {
    singular: { ar: 'موقع المخزون', en: 'Inventory location' },
    plural: { ar: 'مواقع المخزون', en: 'Inventory locations' },
  },
  admin: {
    group: { ar: 'المتجر', en: 'Commerce' },
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'isActive', 'isFulfillable'],
  },
  fields: [
    { name: 'name', type: 'text', required: true, label: { ar: 'الاسم', en: 'Name' } },
    { name: 'slug', type: 'text', label: { ar: 'المعرّف', en: 'Slug' } },
    { name: 'isActive', type: 'checkbox', defaultValue: true, label: { ar: 'مفعّل', en: 'Active' } },
    { name: 'isFulfillable', type: 'checkbox', defaultValue: true, label: { ar: 'قابل للشحن', en: 'Fulfillable' } },
    { name: 'addressLine1', type: 'text', label: { ar: 'العنوان', en: 'Address line 1' } },
    { name: 'addressCity', type: 'text', label: { ar: 'المدينة', en: 'City' } },
    { name: 'addressCountry', type: 'text', label: { ar: 'الدولة', en: 'Country' } },
    { name: 'addressPostalCode', type: 'text', label: { ar: 'الرمز البريدي', en: 'Postal code' } },
    { name: 'contactPhone', type: 'text', label: { ar: 'الهاتف', en: 'Phone' } },
  ],
}
