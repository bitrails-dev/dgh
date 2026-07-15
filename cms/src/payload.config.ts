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
import {
  authenticatedFieldAccess,
  manageUserScopeFieldAccess,
} from './access/userAccess'
import { tenantFeatureAccessPlugin } from './plugins/tenantFeatureAccess'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  admin: {
    user: Users.slug,
    components: {
      logout: {
        Button: '/src/admin/LogoutNavLink#default',
      },
    },
  },
  collections: [
    Users,
    Tenants,
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
  ],
  // HospitalSettings global retired: its fields now live per-tenant on the Tenants collection.
  globals: [],
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
