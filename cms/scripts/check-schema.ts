// Read-only diagnostic: which DB the app actually opens, which article/block tables exist in it,
// and which migrations are recorded there. Run: cd cms && npx tsx scripts/check-schema.ts
import 'dotenv/config'
import { getPayload } from 'payload'
import { sql } from '@payloadcms/db-sqlite'
import config from '../src/payload.config'

async function main() {
  const payload = await getPayload({ config })
  const db = (payload.db as any).drizzle
  const rows = async (q: any) => {
    const r = await db.run(q)
    return (r?.rows ?? r ?? []).map((x: any) => x.name ?? x[0])
  }

  console.log('DATABASE_URI =', process.env.DATABASE_URI ?? '(unset → default file:./cms.db)')
  console.log('articles* tables:', await rows(sql`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'articles%' ORDER BY name`))
  console.log('new tables (icons/categories):', await rows(sql`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('icons','categories','categories_locales') ORDER BY name`))
  console.log('applied migrations:', await rows(sql`SELECT name FROM payload_migrations ORDER BY id`))
  process.exit(0)
}
main().catch((e) => { console.error('check-schema FAILED:', e); process.exit(1) })
