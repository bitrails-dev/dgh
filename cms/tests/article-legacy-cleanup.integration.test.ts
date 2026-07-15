import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const TEMP_DB = join(tmpdir(), `article-cleanup-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'article-cleanup-itest-secret'

const { sql } = await import('@payloadcms/db-sqlite')
const { default: config } = await import('../src/payload.config')
const { down, up } = await import('../src/migrations/20260715_180048_remove_article_legacy_fields')
const { getPayload } = await import('payload')

test('real SQLite upgrade preserves legacy Article category and body as relationship/block data', async (t) => {
  const payload = await getPayload({ config })
  t.after(async () => {
    try {
      await payload.destroy()
    } finally {
      try {
        rmSync(TEMP_DB, { force: true })
      } catch {
        /* disposable temp database */
      }
    }
  })

  await payload.db.migrate()
  const db = (payload.db as any).drizzle

  // Recreate the immediately-pre-cleanup schema, then seed a row that relies on both legacy fields.
  await down({ db } as any)
  await db.run(sql`INSERT INTO \`categories\`
    (\`id\`, \`slug\`, \`color\`, \`updated_at\`, \`created_at\`)
    VALUES (9001, 'legacy-research', 'ink', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`)
  await db.run(sql`INSERT INTO \`articles\`
    (\`id\`, \`slug\`, \`date\`, \`author\`, \`category\`, \`body\`, \`featured\`, \`updated_at\`, \`created_at\`)
    VALUES (9001, 'legacy-article', CURRENT_TIMESTAMP, 'Legacy Author', 'legacy-research',
      'Legacy body preserved by migration.', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`)

  await up({ db } as any)

  const article = (await db.all(sql`SELECT \`category_rel_id\` FROM \`articles\` WHERE \`id\` = 9001;`))[0]
  assert.equal(Number(article.category_rel_id), 9001)

  const columns = await db.all(sql`PRAGMA table_info(\`articles\`);`)
  assert.equal(columns.some((column: any) => column.name === 'category'), false)
  assert.equal(columns.some((column: any) => column.name === 'body'), false)

  const block = (await db.all(sql`SELECT \`id\`, \`_parent_id\`, \`_path\`
    FROM \`articles_blocks_rich_text\` WHERE \`_parent_id\` = 9001;`))[0]
  assert.deepEqual(
    { id: block.id, parentId: Number(block._parent_id), path: block._path },
    { id: 'legacy-body-9001', parentId: 9001, path: 'content' },
  )

  const locales = await db.all(sql`SELECT \`_locale\`, \`rich_text\`
    FROM \`articles_blocks_rich_text_locales\`
    WHERE \`_parent_id\` = 'legacy-body-9001'
    ORDER BY \`_locale\`;`)
  assert.deepEqual(locales.map((row: any) => row._locale), ['ar', 'en'])
  for (const locale of locales) {
    const lexical = JSON.parse(locale.rich_text)
    assert.equal(lexical.root.children[0].children[0].text, 'Legacy body preserved by migration.')
  }

  // The down migration restores the legacy values from their replacements.
  await down({ db } as any)
  const restored = (await db.all(sql`SELECT \`category\`, \`body\` FROM \`articles\` WHERE \`id\` = 9001;`))[0]
  assert.deepEqual(
    { category: restored.category, body: restored.body },
    { category: 'legacy-research', body: 'Legacy body preserved by migration.' },
  )
})
