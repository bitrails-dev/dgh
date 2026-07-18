// promotion-redemptions policy collection (Plan §3.10).
//
// Append-only ledger of promotion redemptions. Each row records one application of a promotion to
// an order, with the discount amount (integer minor units) and the customer identity hash used to
// enforce `perCustomerLimit` for anonymous/guest checkouts. Uniqueness is enforced by (promotion,
// order) — a single order can redeem a given promotion at most once.
//
// `customerIdentityHash` is HMAC-SHA256 of the customer’s stable identifier (customer id when
// authenticated, or the cart’s guest identity hash when anonymous) so the same guest cannot exceed
// `perCustomerLimit` by repeating a checkout. The hash is computed in the promotions policy module
// before the row is created here.

import type { CollectionConfig, CollectionSlug } from 'payload'

const SLUG = 'promotion-redemptions' as const

export const promotionRedemptionSlug = SLUG

// System-managed: only the policy module + checkout flow write rows. Admins read tenant-scoped for
// reporting; super-admins bypass for cross-tenant support.
const systemOnly = () => false

export const PromotionRedemptions: CollectionConfig = {
  slug: SLUG as CollectionSlug,
  labels: {
    singular: { en: 'Promotion redemption', ar: 'استخدام كود' },
    plural: { en: 'Promotion redemptions', ar: 'استخدامات الأكواد' },
  },
  admin: {
    group: { en: 'Commerce policies', ar: 'سياسات المتجر' },
    useAsTitle: 'promotion',
    defaultColumns: ['promotion', 'order', 'discountAmount', 'redeemedAt'],
  },
  access: { create: systemOnly, update: systemOnly, delete: systemOnly },
  indexes: [
    // promotion redemption unique by promotion/order (Plan §3.10 DB constraints).
    { fields: ['promotion', 'order'], unique: true },
    // Per-customer usage queries (perCustomerLimit enforcement).
    { fields: ['promotion', 'customerIdentityHash'] },
  ],
  fields: [
    {
      name: 'promotion',
      type: 'relationship',
      relationTo: 'promotions' as CollectionSlug,
      required: true,
      index: true,
      label: { en: 'Promotion', ar: 'العرض' },
    },
    {
      name: 'order',
      type: 'relationship',
      relationTo: 'store-orders',
      required: true,
      index: true,
      label: { en: 'Order', ar: 'الطلب' },
    },
    {
      name: 'customerIdentityHash',
      type: 'text',
      required: true,
      index: true,
      label: { en: 'Customer identity hash', ar: 'هاش هوية العميل' },
      admin: {
        description:
          'HMAC-SHA256 of the customer id or guest identity. Used to enforce perCustomerLimit.',
        hidden: true,
      },
    },
    {
      name: 'discountAmount',
      type: 'number',
      required: true,
      min: 0,
      label: { en: 'Discount amount', ar: 'مبلغ الخصم' },
      admin: { description: 'Integer minor units actually applied.' },
    },
    {
      name: 'redeemedAt',
      type: 'date',
      required: true,
      index: true,
      label: { en: 'Redeemed at', ar: 'وقت الاستخدام' },
    },
  ],
}
