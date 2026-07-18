import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig } from 'payload'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { ecommercePlugin, defaultCartItemMatcher } from '@payloadcms/plugin-ecommerce'
import { en } from '@payloadcms/translations/languages/en'
import { ar } from '@payloadcms/translations/languages/ar'

import { Users } from './collections/Users'
import { Doctors } from './collections/Doctors'
import { Departments } from './collections/Departments'
import { Articles } from './collections/Articles'
import { Events } from './collections/Events'
import { Awards } from './collections/Awards'
import { Achievements } from './collections/Achievements'
import { Testimonials } from './collections/Testimonials'
import { Media } from './collections/Media'
import { Icons } from './collections/Icons'
import { Categories } from './collections/Categories'
import { Tenants } from './collections/Tenants'
import { TenantTypes } from './collections/TenantTypes'
import { SocialConnections } from './collections/SocialConnections'
import { SocialPublications } from './collections/SocialPublications'
import { SocialOAuthStates } from './collections/SocialOAuthStates'
import {
  InventoryLocations,
  InventoryLevels,
  StockMovements,
  StockReservations,
  InventoryTransfers,
  CommerceSettings,
  PaymentEvents,
  Orders,
  Transactions,
  Products,
  Carts,
  Customers,
} from './collections/commerce'
import {
  authenticatedFieldAccess,
  manageUserScopeFieldAccess,
} from './access/userAccess'
import { tenantFeatureAccessPlugin } from './plugins/tenantFeatureAccess'
import { socialEndpoints } from './social/oauth/endpoints'
import { socialPublishTask } from './social/jobs'
import { commerceWebhookEndpoints } from './commerce/payments/endpoints'
import { commerceStoreEndpoints } from './commerce/store/endpoints'
import { processPaymentEventTask } from './commerce/payments/job'
// Plugin-first commerce (Wave B4). The ecommerce plugin owns base products/variants/carts/addresses/
// orders/transactions under collision-free `store-*` slugs (plan §3.1). B1 override modules append our
// extension fields + tenant hooks; B2 made `customers` Payload-auth; B4 wires the plugin into the config.
import { STORE_COLLECTION_SLUGS } from './commerce/plugin/slugs'
import { EGP } from './commerce/plugin/currency'
import { commercePluginAccess } from './commerce/plugin/access'
import { validateStoreSellable } from './commerce/plugin/validate-sellable'
import { overrideStoreProducts } from './commerce/plugin/overrides/store-products'
import { overrideStoreVariants } from './commerce/plugin/overrides/store-variants'
import { overrideStoreVariantTypes } from './commerce/plugin/overrides/store-variant-types'
import { overrideStoreVariantOptions } from './commerce/plugin/overrides/store-variant-options'
import { overrideStoreCarts } from './commerce/plugin/overrides/store-carts'
import { overrideStoreAddresses } from './commerce/plugin/overrides/store-addresses'
import { overrideStoreOrders } from './commerce/plugin/overrides/store-orders'
import { overrideStoreTransactions } from './commerce/plugin/overrides/store-transactions'
// Plugin-first commerce policy collections (Wave C4) — tenant-scoped tax/shipping/promotion/gift-card
// persistence backing the authoritative quoteCart (plan §3.10).
import { TaxZones } from './commerce/policies/collections/TaxZones'
import { TaxRates } from './commerce/policies/collections/TaxRates'
import { ShippingZones } from './commerce/policies/collections/ShippingZones'
import { ShippingMethods } from './commerce/policies/collections/ShippingMethods'
import { Promotions } from './commerce/policies/collections/Promotions'
import { PromotionRedemptions } from './commerce/policies/collections/PromotionRedemptions'
import { GiftCards } from './commerce/policies/collections/GiftCards'
import { GiftCardLedger } from './commerce/policies/collections/GiftCardLedger'
// Side effect: registers every platform adapter (tier-1 real + tier-2 honest-deferred) into the
// default registry, so each of the eight platforms resolves to a typed adapter with an explicit
// outcome — no generic missing-adapter fallback.
import './social/adapters/register'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  admin: {
    user: Users.slug,
    components: {
      logout: {
        Button: '/src/admin/LogoutNavLink#default',
      },
      // Global provider: closes a successful inline relationship "create" drawer once its new doc is
      // assigned (Article->Category, Tenant->Tenant Type, etc.). Public @payloadcms/ui hooks only.
      providers: [
        { path: '/src/admin/InlineCreateDismissalProvider#default' },
      ],
    },
  },
  collections: [
    Users,
    Tenants,
    TenantTypes,
    Media,
    Icons,
    Categories,
    Doctors,
    Departments,
    Articles,
    Events,
    Awards,
    Achievements,
    Testimonials,
    // Internal (hidden, access-locked) social-publishing collections. Not tenant-plugin-scoped —
    // they carry their own `tenant` relationship and are managed via Local API + the OAuth endpoints.
    SocialConnections,
    SocialPublications,
    SocialOAuthStates,
    // Commerce inventory collections (gated on the `commerce` feature; see tenantFeatureAccess).
    InventoryLocations,
    InventoryLevels,
    StockMovements,
    StockReservations,
    InventoryTransfers,
    // Tenant-global commerce settings (one per tenant) + idempotent payment-event ledger.
    CommerceSettings,
    PaymentEvents,
    // Order/transaction model (own collections — the ecommerce plugin does not compose with
    // multi-tenant; see docs/superpowers/plans/2026-07-17-commerce-implementation.md).
    Orders,
    Transactions,
    Products,
    Carts,
    Customers,
    // Plugin-first commerce policy collections (Wave C4): tenant-scoped tax/shipping/promotion/
    // gift-card persistence backing the authoritative quoteCart (plan §3.10).
    TaxZones,
    TaxRates,
    ShippingZones,
    ShippingMethods,
    Promotions,
    PromotionRedemptions,
    GiftCards,
    GiftCardLedger,
  ],
  // HospitalSettings global retired: its fields now live per-tenant on the Tenants collection.
  globals: [],
  // OAuth connect/callback/disconnect for tenant social connections (tenant-access-controlled), plus
  // the commerce payment webhook routes (source of truth for payment status).
  endpoints: [...socialEndpoints, ...commerceWebhookEndpoints, ...commerceStoreEndpoints],
  // Durable social-publishing. The Article create hook enqueues the `social-publish-article` task;
  // a worker process (`payload jobs:run`) drains it with bounded exponential retry. Exclusive
  // per-article concurrency requires enableConcurrencyControl (adds an indexed concurrencyKey).
  jobs: {
    tasks: [socialPublishTask, processPaymentEventTask],
    enableConcurrencyControl: true,
    // Drain the `social-publishing` + `commerce` queues in-process (every minute) so a single
    // `next start` process is self-sufficient. For higher throughput or process isolation, also run a
    // dedicated worker: `payload jobs:run --queue <queue> --limit 10 --cron '* * * * *'`. NOTE:
    // autoRun is NOT suitable for serverless platforms (Vercel/Lambda) — run a dedicated worker there.
    autoRun: [
      { cron: '* * * * *', queue: 'social-publishing', limit: 10 },
      { cron: '* * * * *', queue: 'commerce', limit: 20 },
    ],
  },
  editor: lexicalEditor(),
  i18n: {
    supportedLanguages: { ar, en },
    fallbackLanguage: 'ar',
  },
  localization: {
    locales: [
      { label: 'العربية', code: 'ar' },
      { label: 'English', code: 'en' },
    ],
    defaultLocale: 'ar',
    fallback: true,
  },
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  plugins: [
    // Order is fixed (plan §3.2): ecommerce FIRST so it appends the `store-*` collections to the
    // incoming config, then multiTenantPlugin attaches tenant fields/access to those generated
    // collections, then tenantFeatureAccessPlugin gates them behind the `commerce` feature. The
    // commerce feature flag stays OFF for all tenants until the release gates pass (plan §0.11).
    // Payment adapters (paymobAdapter/kashierAdapter) are Wave D — paymentMethods is empty for now.
    ecommercePlugin({
      access: commercePluginAccess,
      addresses: {
        supportedCountries: [{ label: 'Egypt', value: 'EG' }],
        addressesCollectionOverride: overrideStoreAddresses,
      },
      carts: {
        allowGuestCarts: true,
        cartItemMatcher: defaultCartItemMatcher,
        cartsCollectionOverride: overrideStoreCarts,
      },
      currencies: {
        defaultCurrency: 'EGP',
        supportedCurrencies: [EGP],
      },
      customers: { slug: 'customers' },
      inventory: false,
      orders: { ordersCollectionOverride: overrideStoreOrders },
      payments: { paymentMethods: [] },
      products: {
        productsCollectionOverride: overrideStoreProducts,
        validation: validateStoreSellable,
        variants: {
          variantsCollectionOverride: overrideStoreVariants,
          variantTypesCollectionOverride: overrideStoreVariantTypes,
          variantOptionsCollectionOverride: overrideStoreVariantOptions,
        },
      },
      slugMap: STORE_COLLECTION_SLUGS,
      transactions: { transactionsCollectionOverride: overrideStoreTransactions },
    }),
    multiTenantPlugin({
      // Every content collection is scoped to a tenant (injects a required, indexed `tenant`
      // relationship). `icons` is intentionally omitted — it's a shared, platform-wide library.
      collections: {
        media: {},
        categories: {},
        doctors: {},
        departments: {},
        articles: {},
        events: {},
        awards: {},
        achievements: {},
        testimonials: {},
        // Commerce inventory collections are tenant-scoped: each tenant owns its locations, levels,
        // movements, reservations, and transfers.
        'inventory-locations': {},
        'inventory-levels': {},
        'stock-movements': {},
        'stock-reservations': {},
        'inventory-transfers': {},
        'commerce-settings': {},
        'payment-events': {},
        orders: {},
        transactions: {},
        products: {},
        carts: {},
        customers: {},
        // Plugin-first commerce collections (Wave B4). The ecommerce plugin generates these `store-*`
        // collections; multiTenantPlugin runs after it (see plugins order below) to attach the tenant
        // relationship + tenant-scoped access. Legacy products/carts/orders/transactions remain
        // registered above for read-only side-by-side migration until Wave F2.
        'store-products': {},
        'store-variants': {},
        'store-variant-types': {},
        'store-variant-options': {},
        'store-carts': {},
        'store-addresses': {},
        'store-orders': {},
        'store-transactions': {},
        // Plugin-first commerce policy collections (Wave C4) — tenant-scoped.
        'tax-zones': {},
        'tax-rates': {},
        'shipping-zones': {},
        'shipping-methods': {},
        promotions: {},
        'promotion-redemptions': {},
        'gift-cards': {},
        'gift-card-ledger': {},
      },
      // Platform operators (roles includes super-admin) bypass tenant scoping and see all tenants.
      userHasAccessToAllTenants: (user) =>
        Boolean((user as { roles?: string[] } | null)?.roles?.includes('super-admin')),
      tenantsArrayField: {
        arrayFieldAccess: {
          read: authenticatedFieldAccess,
          create: manageUserScopeFieldAccess,
          update: manageUserScopeFieldAccess,
        },
        tenantFieldAccess: {
          read: authenticatedFieldAccess,
          create: manageUserScopeFieldAccess,
          update: manageUserScopeFieldAccess,
        },
      },
    }),
    // Capability access runs after tenant scoping so disabled collections disappear from
    // permission-driven admin navigation and remain blocked through direct API/admin URLs.
    tenantFeatureAccessPlugin(),
  ],
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URI || 'file:./cms.db',
      authToken: process.env.DATABASE_AUTH_TOKEN,
    },
    // Rely on versioned migrations (src/migrations) instead of the dev-mode schema push, which
    // collides with existing indexes when migrations exist.
    push: false,
    // Commerce-grade SQLite safety. AUTOINCREMENT PKs so deleted ids are never reused; a 5s
    // busy-timeout so contending writers wait (and serialize) instead of erroring under concurrency;
    // IMMEDIATE transactions that acquire the write lock up front (predictable SQLITE_BUSY at the
    // start, never a mid-transaction deadlock); WAL with synchronous=FULL for durable crash-safe
    // commits. Together these make stock-reservation/order-creation write contention correct.
    autoIncrement: true,
    busyTimeout: 5000,
    transactionOptions: { behavior: 'immediate' },
    wal: { synchronous: 'FULL' },
  }),
})
