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
import { COMMERCE_PERMISSIONS } from './commerce/permissions'
import { tenantFeatureAccessPlugin } from './plugins/tenantFeatureAccess'
import { socialEndpoints } from './social/oauth/endpoints'
import { socialPublishTask } from './social/jobs'
import { commerceWebhookEndpoints } from './commerce/payments/endpoints'
import { commerceStoreEndpoints } from './commerce/store/endpoints'
import { processPaymentEventTask } from './commerce/payments/job'
// Wave E1: durable commerce notifications (Plan §7 E1). The D3 payment side-effect bundle enqueues
// the `send-commerce-notification` task; registering its body here lets those events reach
// processed=1 (and powers account-verification / password-reset / order + payment notifications).
import { sendCommerceNotificationTask } from './commerce/notifications'
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
// Wave D1/D2 payment adapters (Plan §3.2). Added to `paymentMethods` at D4 so the ecommerce plugin's
// payment endpoints register for Paymob + Kashier; each adapter's first operation is the §3.2 tenant
// re-read, so direct unsigned calls get 403 once the gateway helper stashes the resolved tenant.
// `paymobAdapter` is D1's pre-built adapter INSTANCE (createPaymobAdapter()); `kashierAdapter` is a
// factory (D2) — the two adapters were exported with different shapes, so one is passed directly and
// the other invoked. Both yield a plugin PaymentAdapter for the paymentMethods array.
import { paymobAdapter } from './commerce/payments/adapters/paymob'
import { kashierAdapter } from './commerce/payments/adapters/kashier'
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
      // Bitrails rebrand: replace the default Payload logo (login page + dashboard header) and the
      // sidebar/nav icon with the Bitrails mark (terracotta "B" + cyan dot). See
      // cms/src/admin/BitrailsLogo.tsx + BitrailsIcon.tsx.
      graphics: {
        Logo: '/src/admin/BitrailsLogo#default',
        Icon: '/src/admin/BitrailsIcon#default',
      },
    },
    // Bitrails rebrand: every admin <title> renders "... - Bitrails" instead of "... - Payload",
    // and share/OG previews say "Bitrails" (admin pages are noindex, but the metadata is still
    // emitted). Defaults come from payload/dist/config/defaults.js (titleSuffix: '- Payload').
    meta: {
      titleSuffix: '- Bitrails',
      title: 'Bitrails',
      description: 'Bitrails admin',
      openGraph: {
        title: 'Bitrails',
        siteName: 'Bitrails',
        description: 'Bitrails admin',
      },
      // Override the bundled Payload favicon PNGs with the Bitrails mark SVG. The static file at
      // cms/src/app/(payload)/icon.svg is also served by Next.js' file convention; setting it
      // explicitly here guarantees it wins over @payloadcms/next's default icon emission
      // (meta.js falls back to payload-favicon-*.png when `icons` is unset).
      icons: [{ rel: 'icon', type: 'image/svg+xml', url: '/icon.svg' }],
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
    // Legacy order/transaction/product/cart collections. NOTE (Wave F2): the runtime orchestration
    // that WROTE these is retired — no live path writes them (grep-verified across cms/src/commerce).
    // The registrations are RETAINED because @payloadcms/plugin-multi-tenant's tenant-scoping list and
    // a plugin relationship field still reference these legacy slugs (removing the collections throws
    // InvalidFieldRelationship at sanitize). Fully unregistering them is a follow-up that must first
    // repoint those references to the store-* collections. Historical DB tables remain on disk
    // regardless (cutover rollback).
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
    tasks: [socialPublishTask, processPaymentEventTask, sendCommerceNotificationTask],
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
  // NOTE: Payload config itself keeps the `|| ''` fallback so the config can boot for migration
  // tooling (`generate:types`, `migrate`) without a live secret. Commerce crypto
  // (cms/src/commerce/crypto.ts, cms/src/social/crypto.ts) requires PAYLOAD_SECRET to be set at
  // runtime to >= 32 bytes — `requirePayloadSecret()` throws there. Do not rely on this fallback
  // for runtime serving.
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
      payments: { paymentMethods: [paymobAdapter, kashierAdapter()] },
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
        // Per-assignment commerce permission matrix. The reader (cms/src/commerce/permissions.ts)
        // and the commerce access functions (cms/src/commerce/plugin/access.ts) already consume this
        // field; declaring it here as a rowField makes it a real schema field with a UI control and
        // persisted storage (join table `users_tenants_commerce_permissions`). Role-based defaults
        // (admin → all, editor → catalog.manage) are stamped by `enforceUserScope` on create/update
        // when unset, and existing users are backfilled by migration
        // 20260721_140149_commerce_permissions_field (which MUST be paired with its .json snapshot —
        // see the comment at the top of that migration file).
        rowFields: [
          {
            name: 'commercePermissions',
            type: 'select',
            hasMany: true,
            label: { ar: 'صلاحيات التجارة', en: 'Commerce permissions' },
            // `COMMERCE_PERMISSIONS` is exported `as const` (readonly); Payload's `options` expects a
            // mutable Option[], so spread into a plain array. The source of truth stays the const.
            options: [...COMMERCE_PERMISSIONS],
            access: {
              read: authenticatedFieldAccess,
              create: manageUserScopeFieldAccess,
              update: manageUserScopeFieldAccess,
            },
          },
        ],
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
