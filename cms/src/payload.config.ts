import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig } from 'payload'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'

import { Users } from './collections/Users'
import { Doctors } from './collections/Doctors'
import { Departments } from './collections/Departments'
import { Articles } from './collections/Articles'
import { Events } from './collections/Events'
import { Awards } from './collections/Awards'
import { Achievements } from './collections/Achievements'
import { Testimonials } from './collections/Testimonials'
import { HospitalSettings } from './globals/HospitalSettings'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  admin: { user: Users.slug },
  collections: [
    Users,
    Doctors,
    Departments,
    Articles,
    Events,
    Awards,
    Achievements,
    Testimonials,
  ],
  globals: [HospitalSettings],
  // ponytail: textarea markdown fields, no uploads/Media collection — current content is
  // markdown + external image URLs. Add a Media collection + S3/R2 storage when editors
  // actually upload files.
  editor: lexicalEditor(),
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
