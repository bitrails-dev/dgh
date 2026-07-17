import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig } from 'payload'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
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
  authenticatedFieldAccess,
  manageUserScopeFieldAccess,
} from './access/userAccess'
import { tenantFeatureAccessPlugin } from './plugins/tenantFeatureAccess'
import { socialEndpoints } from './social/oauth/endpoints'
import { socialPublishTask } from './social/jobs'
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
  ],
  // HospitalSettings global retired: its fields now live per-tenant on the Tenants collection.
  globals: [],
  // OAuth connect/callback/disconnect for tenant social connections (tenant-access-controlled).
  endpoints: socialEndpoints,
  // Durable social-publishing. The Article create hook enqueues the `social-publish-article` task;
  // a worker process (`payload jobs:run`) drains it with bounded exponential retry. Exclusive
  // per-article concurrency requires enableConcurrencyControl (adds an indexed concurrencyKey).
  jobs: {
    tasks: [socialPublishTask],
    enableConcurrencyControl: true,
    // Drain the `social-publishing` queue in-process (every minute) so a single `next start` process
    // is self-sufficient. For higher throughput or process isolation, also run a dedicated worker:
    // `payload jobs:run --queue social-publishing --limit 10 --cron '* * * * *'`. NOTE: autoRun is NOT
    // suitable for serverless platforms (Vercel/Lambda) — run the dedicated worker there instead.
    autoRun: [{ cron: '* * * * *', queue: 'social-publishing', limit: 10 }],
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
    // Rely on versioned migrations (src/migrations) instead of the dev-mode
    // schema push, which collides with existing indexes when migrations exist.
    push: false,
  }),
})
