import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig } from 'payload'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
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
import { HospitalSettings } from './globals/HospitalSettings'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  admin: { user: Users.slug },
  collections: [
    Users,
    Media,
    Doctors,
    Departments,
    Articles,
    Events,
    Awards,
    Achievements,
    Testimonials,
  ],
  globals: [HospitalSettings],
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
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URI || 'file:./cms.db',
      authToken: process.env.DATABASE_AUTH_TOKEN,
    },
  }),
})
