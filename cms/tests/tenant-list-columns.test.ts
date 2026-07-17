// Task B (part 1): the multi-tenant plugin injects a required `tenant` relationship with
// `admin.disableListColumn: true` and `admin.disableListFilter: true`, so super-admin aggregate
// lists hide the ownership column and filter. Our plugin override surfaces both and adds `tenant`
// to default columns for every tenant-scoped collection. UI visibility never broadens API access:
// non-super users stay constrained by the access/filterOptions layer.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Config } from 'payload'
import { tenantFeatureAccessPlugin } from '../src/plugins/tenantFeatureAccess'

// The nine collections the multi-tenant plugin scopes (payload.config.ts multiTenantPlugin.collections).
const SCOPED = [
  'media', 'categories', 'doctors', 'departments',
  'articles', 'events', 'awards', 'achievements', 'testimonials',
]

const buildConfig = (opts: { withTenantField?: boolean; withDefaultColumns?: boolean } = {}): Config => {
  const withTenantField = opts.withTenantField ?? true
  const withDefaultColumns = opts.withDefaultColumns ?? true
  return {
    collections: SCOPED.map((slug) => ({
      slug,
      fields: withTenantField
        ? [{
            name: 'tenant',
            type: 'relationship' as const,
            relationTo: 'tenants',
            // Mirrors what the multi-tenant plugin injects (both disabled).
            admin: { disableListColumn: true, disableListFilter: true },
          }]
        : [],
      ...(withDefaultColumns ? { admin: { defaultColumns: ['title'] } } : {}),
    })),
  } as unknown as Config
}

// The Plugin type permits Promise<Config>; ours is synchronous, so assert Config at the seam and
// keep the rest of the test fully typed.
const applyPlugin = (cfg: Config): Config => tenantFeatureAccessPlugin()(cfg) as Config

test('the tenant list column and filter are enabled on every scoped collection', () => {
  const config = applyPlugin(buildConfig())
  for (const slug of SCOPED) {
    const col = config.collections!.find((c) => c.slug === slug)!
    const tenantField = col.fields.find((f) => 'name' in f && (f as { name?: string }).name === 'tenant') as
      | { admin?: { disableListColumn?: boolean; disableListFilter?: boolean } }
      | undefined
    assert.ok(tenantField, `${slug} must have a tenant field`)
    assert.equal(tenantField.admin?.disableListColumn, false, `${slug}: tenant list column must be enabled`)
    assert.equal(tenantField.admin?.disableListFilter, false, `${slug}: tenant list filter must be enabled`)
  }
})

test("'tenant' appears in default columns of every scoped collection", () => {
  const config = applyPlugin(buildConfig())
  for (const slug of SCOPED) {
    const col = config.collections!.find((c) => c.slug === slug)!
    assert.ok(
      col.admin?.defaultColumns?.includes('tenant'),
      `${slug}: tenant must be a default list column`,
    )
  }
})

test('tenant is appended only once even if the plugin runs twice (idempotent)', () => {
  const once = applyPlugin(buildConfig())
  const twice = applyPlugin(once)
  for (const slug of SCOPED) {
    const col = twice.collections!.find((c) => c.slug === slug)!
    const count = col.admin?.defaultColumns?.filter((c) => c === 'tenant').length ?? 0
    assert.equal(count, 1, `${slug}: tenant column must not duplicate`)
  }
})

test('a scoped collection with no defaultColumns still gets tenant shown', () => {
  const config = applyPlugin(buildConfig({ withDefaultColumns: false }))
  for (const slug of SCOPED) {
    const col = config.collections!.find((c) => c.slug === slug)!
    assert.ok(col.admin?.defaultColumns?.includes('tenant'), `${slug}: tenant column added when none existed`)
  }
})

test('collections without an injected tenant field are left untouched (e.g. shared icons)', () => {
  const config = applyPlugin(buildConfig({ withTenantField: false }))
  for (const slug of SCOPED) {
    const col = config.collections!.find((c) => c.slug === slug)!
    assert.equal(col.fields.length, 0, `${slug}: no fields added`)
    // No spurious tenant column on collections that have no tenant relationship.
    assert.equal(col.admin?.defaultColumns?.includes('tenant') ?? false, false)
  }
})
