import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { Articles } from '../src/collections/Articles'

const migrationDirectory = new URL('../src/migrations/', import.meta.url)

test('Articles exposes only the relationship category and block content fields', () => {
  const fieldNames = Articles.fields
    .map((field) => ('name' in field ? field.name : undefined))
    .filter(Boolean)

  assert.equal(fieldNames.includes('category'), false)
  assert.equal(fieldNames.includes('body'), false)
  assert.equal(fieldNames.includes('categoryRel'), true)
  assert.equal(fieldNames.includes('content'), true)
  assert.deepEqual(Articles.admin?.defaultColumns, ['title', 'date', 'categoryRel', 'featured'])
})

test('cleanup migration snapshot removes only the two legacy Article columns', () => {
  const before = JSON.parse(
    readFileSync(new URL('20260715_155701_settings_entitlement.json', migrationDirectory), 'utf8'),
  )
  const after = JSON.parse(
    readFileSync(new URL('20260715_180048_remove_article_legacy_fields.json', migrationDirectory), 'utf8'),
  )

  delete before.id
  delete before.prevId
  delete after.id
  delete after.prevId
  delete before.tables.articles.columns.category
  delete before.tables.articles.columns.body

  assert.deepEqual(after, before)
})

test('cleanup migration SQL does not alter unrelated tables', () => {
  const migration = readFileSync(
    new URL('20260715_180048_remove_article_legacy_fields.ts', migrationDirectory),
    'utf8',
  )

  assert.match(migration, /DROP COLUMN \\`category\\`/)
  assert.match(migration, /DROP COLUMN \\`body\\`/)
  assert.doesNotMatch(migration, /tenants/)
})
