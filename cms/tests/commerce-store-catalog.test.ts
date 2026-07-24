// Catalog orchestration tests (Wave F2 Lane A — plugin-first). listProducts / getProduct are called
// directly with payload + tenantId (no HTTP), matching the webhook-endpoint test pattern: temp DB,
// getPayload, payload.db.migrate(), seedTenant. The catalog now reads the ecommerce plugin's
// `store-products` / `store-variants` collections (not legacy `products`): published filter is
// `_status: 'published'` (was legacy `status: 'active'`), price comes from `priceInEGP`, the
// localized `name` round-trips + drives locale-aware q search, and variant-bearing products surface
// their `store-variants` children. Asserts published-only filtering, tenant isolation, localized
// reads, variant surfacing, id/slug lookup, draft exclusion, and server-side image URL resolution.
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

  // Simple published product (own SKU + price). The plugin products collection has drafts on; the
  // `_status` select defaults to 'draft', so a published row is seeded by setting `_status:'published'`
  // in the create data (the same column the plugin's adminOrPublishedStatus access + this catalog
  // filter on). payload.create only force-sets _status='draft' when draft:true is passed.
  const simple = await payload.create({
    collection: 'store-products',
    overrideAccess: true,
    data: {
      tenant: commerceTenantId,
      name: 'Classic T-Shirt',
      slug: 'classic-t-shirt',
      sku: 'TSHIRT-001',
      description: 'A plain cotton tee.',
      priceInEGPEnabled: true,
      priceInEGP: 5000,
      taxClass: 'standard',
      trackInventory: true,
      images: [mediaId],
      _status: 'published',
    } as any,
  })
  simpleId = simple.id
  await payload.update({
    collection: 'store-products',
    id: simple.id,
    locale: 'en',
    overrideAccess: true,
    data: {
      name: 'Classic T-Shirt',
      description: 'A plain cotton tee.',
    },
  })
  await payload.update({
    collection: 'store-products',
    id: simple.id,
    locale: 'ar',
    overrideAccess: true,
    data: {
      name: 'قميص كلاسيكي',
      description: 'قميص قطني بسيط.',
    },
  })

  // Variant-bearing parent (null product SKU; sellable children live in store-variants). Built with a
  // variant-type + two options so the plugin's variant validation accepts the two priced variants.
  const vtype = await payload.create({
    collection: 'store-variant-types',
    overrideAccess: true,
    data: { tenant: commerceTenantId, label: 'Size', name: 'size' } as any,
  })
  const optS = await payload.create({
    collection: 'store-variant-options',
    overrideAccess: true,
    data: { tenant: commerceTenantId, variantType: vtype.id, label: 'Small', value: 'S' } as any,
  })
  const optL = await payload.create({
    collection: 'store-variant-options',
    overrideAccess: true,
    data: { tenant: commerceTenantId, variantType: vtype.id, label: 'Large', value: 'L' } as any,
  })
  const variant = await payload.create({
    collection: 'store-products',
    overrideAccess: true,
    data: {
      tenant: commerceTenantId,
      name: 'Sneakers',
      slug: 'sneakers',
      sku: null,
      enableVariants: true,
      variantTypes: [vtype.id],
      taxClass: 'standard',
      trackInventory: true,
      _status: 'published',
    } as any,
  })
  variantId = variant.id
  await payload.create({
    collection: 'store-variants',
    overrideAccess: true,
    data: {
      tenant: commerceTenantId,
      product: variant.id,
      options: [optS.id],
      sku: 'SHOE-001-S',
      priceInEGPEnabled: true,
      priceInEGP: 12000,
    } as any,
  })
  await payload.create({
    collection: 'store-variants',
    overrideAccess: true,
    data: {
      tenant: commerceTenantId,
      product: variant.id,
      options: [optL.id],
      sku: 'SHOE-001-L',
      priceInEGPEnabled: true,
      priceInEGP: 12500,
    } as any,
  })

  // Draft product — must be excluded from the public catalog.
  const draft = await payload.create({
    collection: 'store-products',
    overrideAccess: true,
    data: {
      tenant: commerceTenantId,
      name: 'Draft Hoodie',
      slug: 'draft-hoodie',
      sku: 'HOODIE-001',
      priceInEGPEnabled: true,
      priceInEGP: 8000,
      taxClass: 'standard',
      trackInventory: true,
      _status: 'draft',
    } as any,
  })
  draftId = draft.id

  const other = await payload.create({
    collection: 'store-products',
    overrideAccess: true,
    data: {
      tenant: otherTenantId,
      name: 'Other Tenant Mug',
      slug: 'other-mug',
      sku: 'MUG-999',
      priceInEGPEnabled: true,
      priceInEGP: 3000,
      taxClass: 'standard',
      trackInventory: true,
      _status: 'published',
    } as any,
  })
  otherTenantProductId = other.id
})

test.after(async () => {
  try { try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* libsql native teardown fix (commit 1630a03) */ } await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

test('listProducts returns only published products for the tenant (drafts excluded)', async () => {
  const { products, total } = await listProducts(payload, commerceTenantId)
  const ids = products.map((p) => String(p.id))
  assert.ok(ids.includes(String(simpleId)), 'includes the published simple product')
  assert.ok(ids.includes(String(variantId)), 'includes the published variant-bearing product')
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

test('listProducts surfaces variant children on a variant-bearing product', async () => {
  const { products } = await listProducts(payload, commerceTenantId)
  const v = products.find((p) => String(p.id) === String(variantId))
  assert.ok(v, 'variant-bearing product present')
  assert.equal(Array.isArray(v!.variants), true)
  assert.equal((v!.variants as any[]).length, 2)
  const skus = (v!.variants as any[]).map((x) => x.sku).sort()
  assert.deepEqual(skus, ['SHOE-001-L', 'SHOE-001-S'])
  const large = (v!.variants as any[]).find((x) => x.sku === 'SHOE-001-L')
  assert.equal(large!.price, 12500, 'variant child price comes from store-variants.priceInEGP')
})

test('listProducts maps priceInEGP to the storefront price and name round-trips', async () => {
  const { products } = await listProducts(payload, commerceTenantId, { locale: 'en' })
  const s = products.find((p) => String(p.id) === String(simpleId))
  assert.ok(s, 'simple product present')
  assert.equal(s!.name, 'Classic T-Shirt')
  assert.equal(s!.price, 5000)
  assert.equal(s!.sku, 'TSHIRT-001')
})

test('listProducts and getProduct return the requested product locale', async () => {
  const arabic = await listProducts(payload, commerceTenantId, { locale: 'ar', q: 'كلاسيكي' })
  assert.equal(arabic.total, 1)
  assert.equal(arabic.products[0].name, 'قميص كلاسيكي')
  assert.equal(arabic.products[0].description, 'قميص قطني بسيط.')

  const english = await getProduct(payload, commerceTenantId, 'classic-t-shirt', 'en')
  assert.equal(english?.name, 'Classic T-Shirt')
  assert.equal(english?.description, 'A plain cotton tee.')
})

test('listProducts q filters the name case-insensitively', async () => {
  const { products, total } = await listProducts(payload, commerceTenantId, {
    q: 'classic',
    locale: 'en',
  })
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

test('listProducts drops an image whose media doc was deleted', async () => {
  // Plugin `images` is a real relationship, so a non-existent id is rejected at create time by
  // referential validation. The dangling-ref case is therefore seeded by attaching a real media doc
  // and then deleting it — the product keeps the dead ref, which loadMediaMap must drop silently.
  const ghostMedia = await payload.create({
    collection: 'media',
    overrideAccess: true,
    data: { tenant: commerceTenantId, alt: 'gone' },
    file: { data: PNG, mimetype: 'image/png', name: 'ghost.png', size: PNG.length },
  } as any)
  await payload.create({
    collection: 'store-products',
    overrideAccess: true,
    data: {
      tenant: commerceTenantId,
      name: 'Ghost Image Tee',
      slug: 'ghost-tee',
      sku: 'GHOST-001',
      priceInEGPEnabled: true,
      priceInEGP: 1000,
      taxClass: 'standard',
      trackInventory: true,
      images: [ghostMedia.id],
      _status: 'published',
    } as any,
  })
  await payload.delete({ collection: 'media', id: ghostMedia.id, overrideAccess: true } as any)
  const { products } = await listProducts(payload, commerceTenantId)
  const g = products.find((p) => p.sku === 'GHOST-001')
  assert.ok(g, 'ghost product present')
  assert.equal(g!.images.length, 0, 'dangling media ref dropped')
})

test('getProduct by id returns the projected product', async () => {
  const p = await getProduct(payload, commerceTenantId, String(simpleId), 'en')
  assert.ok(p)
  assert.equal(p!.sku, 'TSHIRT-001')
  assert.equal(p!.price, 5000)
  assert.equal(p!.name, 'Classic T-Shirt')
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
