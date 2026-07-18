// Catalog orchestration tests. listProducts / getProduct are called directly with payload + tenantId
// (no HTTP), matching the webhook-endpoint test pattern: temp DB, getPayload, payload.db.migrate(),
// seedTenant. Asserts active-only filtering, tenant isolation, variant pass-through, id/slug lookup,
// draft exclusion, and server-side image URL resolution (the storefront never trusts client prices).
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-store-catalog-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-store-catalog-itest-secret'
process.env.PAYLOAD_PUBLIC_SERVER_URL = process.env.PAYLOAD_PUBLIC_SERVER_URL || 'http://localhost:3001'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { listProducts, getProduct } = await import('../src/commerce/store/catalog')

let commerceTenantId: number | string
let otherTenantId: number | string
let simpleId: number | string
let variantId: number | string
let draftId: number | string
let otherTenantProductId: number | string
let mediaId: number | string

// A valid 1x1 PNG so the media upload collection accepts a real document with a populated url.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

test.before(async () => {
  const a = await seedTenant(payload, { features: ['commerce'] })
  commerceTenantId = a.tenantId
  const b = await seedTenant(payload, { features: ['commerce'] })
  otherTenantId = b.tenantId

  const media = await payload.create({
    collection: 'media',
    overrideAccess: true,
    data: { tenant: commerceTenantId, alt: 'A product photo' },
    file: { data: PNG, mimetype: 'image/png', name: 'product.png', size: PNG.length },
  } as any)
  mediaId = media.id

  const simple = await payload.create({
    collection: 'products',
    overrideAccess: true,
    data: {
      tenant: commerceTenantId,
      name: 'Classic T-Shirt',
      slug: 'classic-t-shirt',
      sku: 'TSHIRT-001',
      description: 'A plain cotton tee.',
      price: 5000,
      compareAtPrice: 6000,
      productKind: 'physical',
      trackInventory: true,
      status: 'active',
      images: [mediaId],
    } as any,
  })
  simpleId = simple.id

  const variant = await payload.create({
    collection: 'products',
    overrideAccess: true,
    data: {
      tenant: commerceTenantId,
      name: 'Sneakers',
      slug: 'sneakers',
      sku: 'SHOE-001',
      price: 12000,
      productKind: 'physical',
      trackInventory: true,
      status: 'active',
      variants: [
        { sku: 'SHOE-001-S', name: 'Small', price: 12000, compareAtPrice: 14000 },
        { sku: 'SHOE-001-L', name: 'Large', price: 12500, taxBps: 1400 },
      ],
    } as any,
  })
  variantId = variant.id

  const draft = await payload.create({
    collection: 'products',
    overrideAccess: true,
    data: {
      tenant: commerceTenantId,
      name: 'Draft Hoodie',
      slug: 'draft-hoodie',
      sku: 'HOODIE-001',
      price: 8000,
      status: 'draft',
    } as any,
  })
  draftId = draft.id

  const other = await payload.create({
    collection: 'products',
    overrideAccess: true,
    data: {
      tenant: otherTenantId,
      name: 'Other Tenant Mug',
      slug: 'other-mug',
      sku: 'MUG-999',
      price: 3000,
      status: 'active',
    } as any,
  })
  otherTenantProductId = other.id
})

test.after(async () => {
  try { try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* libsql native teardown fix (commit 1630a03) */ } await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

test('listProducts returns only active products for the tenant (drafts excluded)', async () => {
  const { products, total } = await listProducts(payload, commerceTenantId)
  const ids = products.map((p) => String(p.id))
  assert.ok(ids.includes(String(simpleId)), 'includes the active simple product')
  assert.ok(ids.includes(String(variantId)), 'includes the active variant product')
  assert.ok(!ids.includes(String(draftId)), 'excludes the draft product')
  assert.equal(total, 2)
})

test('listProducts is tenant-isolated', async () => {
  const ours = await listProducts(payload, commerceTenantId)
  assert.ok(!ours.products.map((p) => p.sku).includes('MUG-999'), 'other tenant product not leaked')
  const theirs = await listProducts(payload, otherTenantId)
  assert.ok(theirs.products.map((p) => p.sku).includes('MUG-999'), 'other tenant sees its own')
  assert.equal(theirs.total, 1)
})

test('listProducts passes the raw variants array through unchanged', async () => {
  const { products } = await listProducts(payload, commerceTenantId)
  const v = products.find((p) => String(p.id) === String(variantId))
  assert.ok(v, 'variant product present')
  assert.equal(Array.isArray(v!.variants), true)
  assert.equal((v!.variants as any[]).length, 2)
  assert.equal((v!.variants as any[])[0].sku, 'SHOE-001-S')
  assert.equal((v!.variants as any[])[1].taxBps, 1400)
})

test('listProducts q filters the name case-insensitively', async () => {
  const { products, total } = await listProducts(payload, commerceTenantId, { q: 'classic' })
  assert.equal(total, 1)
  assert.equal(products[0].name, 'Classic T-Shirt')
})

test('listProducts paginates', async () => {
  const page1 = await listProducts(payload, commerceTenantId, { limit: 1, page: 1 })
  assert.equal(page1.products.length, 1)
  assert.equal(page1.total, 2)
  const page2 = await listProducts(payload, commerceTenantId, { limit: 1, page: 2 })
  assert.equal(page2.products.length, 1)
  assert.notEqual(String(page2.products[0].id), String(page1.products[0].id))
})

test('listProducts resolves media images to absolute URLs', async () => {
  const { products } = await listProducts(payload, commerceTenantId)
  const s = products.find((p) => String(p.id) === String(simpleId))
  assert.ok(s, 'simple product present')
  assert.equal(s!.images.length, 1)
  assert.equal(String(s!.images[0].id), String(mediaId))
  assert.equal(s!.images[0].alt, 'A product photo')
  assert.match(s!.images[0].url, /^http:\/\/localhost:3001\//, `url is absolute, got ${s!.images[0].url}`)
})

test('listProjects skips a dead/missing image id', async () => {
  await payload.create({
    collection: 'products',
    overrideAccess: true,
    data: {
      tenant: commerceTenantId,
      name: 'Ghost Image Tee',
      slug: 'ghost-tee',
      sku: 'GHOST-001',
      price: 1000,
      status: 'active',
      images: [99999999],
    } as any,
  })
  const { products } = await listProducts(payload, commerceTenantId)
  const g = products.find((p) => p.sku === 'GHOST-001')
  assert.ok(g, 'ghost product present')
  assert.equal(g!.images.length, 0, 'dead image id dropped')
})

test('getProduct by id returns the projected product', async () => {
  const p = await getProduct(payload, commerceTenantId, String(simpleId))
  assert.ok(p)
  assert.equal(p!.sku, 'TSHIRT-001')
  assert.equal(p!.price, 5000)
  assert.equal(p!.compareAtPrice, 6000)
})

test('getProduct by slug returns the projected product', async () => {
  const p = await getProduct(payload, commerceTenantId, 'classic-t-shirt')
  assert.ok(p)
  assert.equal(p!.slug, 'classic-t-shirt')
  assert.equal(p!.images.length, 1)
})

test('getProduct returns null for a draft product (by id and slug)', async () => {
  assert.equal(await getProduct(payload, commerceTenantId, String(draftId)), null)
  assert.equal(await getProduct(payload, commerceTenantId, 'draft-hoodie'), null)
})

test('getProduct is tenant-isolated', async () => {
  assert.equal(await getProduct(payload, commerceTenantId, String(otherTenantProductId)), null)
})

test('getProduct returns null for an unknown id/slug', async () => {
  assert.equal(await getProduct(payload, commerceTenantId, 'no-such-slug'), null)
})
