// Public catalog endpoints (GET /api/commerce/store/:tenantSlug/products[/:id]). The HTTP route is a
// thin handler over directly-callable orchestration (listProducts / getProduct), mirroring the
// payments/webhook pattern: tenant resolved by URL slug → 404 for an unknown tenant or one lacking
// the `commerce` feature. Products are loaded server-side with overrideAccess and projected to a
// storefront shape; client-supplied prices are never trusted (this surface is read-only).
//
// Wave F2 Lane A: reads the ecommerce plugin's `store-products` / `store-variants` collections (not
// the legacy `products` table). Plugin products carry `priceInEGP` (mapped to the storefront `price`)
// and a single-string `name`; the plugin enables `versions.drafts`, so the published filter is
// `_status: 'published'` (was legacy `status: 'active'`). Variant-bearing products surface their
// `store-variants` children through ONE batched variant read, grouped by parent. `compareAtPrice` /
// `productKind` have no plugin equivalent and are left absent (the shape fields stay optional).
//
// Images are a `media` relationship array on the product; we resolve them with ONE batched media
// `find` (`id in [...]`) per request and skip any dead/missing ID. Media URLs are made absolute
// against PAYLOAD_PUBLIC_SERVER_URL so the storefront can render them directly.
import type { Endpoint, Payload, PayloadRequest, Where } from 'payload'
import { resolveStoreTenant } from './shared'
import { STORE_COLLECTION_SLUGS } from '../plugin/slugs'

export interface StoreImage {
  id: number | string
  url: string
  alt?: string
}

export interface StoreProduct {
  id: number | string
  name: string
  slug?: string
  sku: string
  price: number
  compareAtPrice?: number
  description?: string
  productKind?: string
  trackInventory?: boolean
  variants: unknown[]
  images: StoreImage[]
}

type RawProduct = {
  id: number | string
  name?: string | null
  slug?: string
  sku?: string | null
  description?: string | null
  priceInEGP?: number | null
  trackInventory?: boolean | null
  images?: unknown[] | null
}

type RawVariant = {
  id: number | string
  product?: unknown
  sku?: string
  title?: string | null
  priceInEGP?: number | null
}

type RawMedia = {
  id: number | string
  url?: string
  filename?: string
  alt?: string | null
}

const serverBase = (): string => (process.env.PAYLOAD_PUBLIC_SERVER_URL || '').replace(/\/+$/, '')

// Relative media URLs are prefixed with the configured server origin; absolute URLs pass through.
const absolutize = (u: string): string => {
  if (/^https?:\/\//i.test(u)) return u
  const base = serverBase()
  return `${base}${u.startsWith('/') ? '' : '/'}${u}`
}

// Payload upload docs carry an authoritative `url`; fall back to the static path built from filename.
const mediaUrl = (m: RawMedia): string | undefined => {
  const raw = m.url ?? (m.filename ? `/uploads/${m.filename}` : undefined)
  return raw ? absolutize(raw) : undefined
}

// Read a relationship ref as a doc id whether it stored a populated doc or a bare id (mirrors
// cart-v2.ts relId). Queries here run at depth:0 so relationships come back as bare ids, but this
// stays correct even if a caller bumps depth.
function relId(v: unknown): number | string | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'object') {
    const id = (v as { id?: unknown }).id
    return id === undefined ? undefined : (id as number | string)
  }
  return v as number | string
}

// One batched media fetch per request builds an id→image map; dead IDs simply never appear in it.
async function loadMediaMap(payload: Payload, products: RawProduct[]): Promise<Map<string, StoreImage>> {
  const ids = new Set<string>()
  for (const p of products) {
    if (Array.isArray(p.images)) {
      for (const mid of p.images) {
        const id = relId(mid)
        if (id !== undefined) ids.add(String(id))
      }
    }
  }
  const map = new Map<string, StoreImage>()
  if (ids.size === 0) return map
  const { docs } = await payload.find({
    collection: 'media',
    where: { id: { in: [...ids] } },
    overrideAccess: true,
    limit: ids.size,
  })
  for (const m of docs as RawMedia[]) {
    const url = mediaUrl(m)
    if (!url) continue
    map.set(String(m.id), { id: m.id, url, alt: m.alt ?? undefined })
  }
  return map
}

// One batched store-variants fetch per request builds a parent-id → variant-docs map. Variant-bearing
// products have a null product-level SKU; their sellable children live in `store-variants`, keyed back
// to the parent via the `product` relationship. Catalogs are small per tenant, so a high cap suffices.
async function loadVariantsMap(
  payload: Payload,
  tenantId: number | string,
  productIds: Array<number | string>,
): Promise<Map<string, RawVariant[]>> {
  const map = new Map<string, RawVariant[]>()
  if (productIds.length === 0) return map
  const { docs } = await payload.find({
    collection: STORE_COLLECTION_SLUGS.variants,
    where: { and: [{ tenant: { equals: tenantId } }, { product: { in: productIds } }] },
    overrideAccess: true,
    limit: 1000,
    depth: 0,
  })
  for (const v of docs as RawVariant[]) {
    const pid = relId(v.product)
    if (pid === undefined) continue
    const key = String(pid)
    const arr = map.get(key) ?? []
    arr.push(v)
    map.set(key, arr)
  }
  return map
}

// Project a raw store-variant row to the storefront variant shape (id + sku + display title + price).
function projectVariant(v: RawVariant): unknown {
  return {
    id: v.id,
    sku: typeof v.sku === 'string' ? v.sku : '',
    name: typeof v.title === 'string' ? v.title : '',
    price: typeof v.priceInEGP === 'number' ? v.priceInEGP : undefined,
  }
}

// Project a raw store-product row to the storefront shape; variants are the parent's resolved
// store-variants children. Unresolved image IDs are silently dropped. `compareAtPrice`/`productKind`
// have no plugin equivalent and are omitted (the optional shape fields stay in the interface).
function project(
  p: RawProduct,
  media: Map<string, StoreImage>,
  variants: Map<string, RawVariant[]>,
): StoreProduct {
  const images: StoreImage[] = []
  if (Array.isArray(p.images)) {
    for (const mid of p.images) {
      const id = relId(mid)
      if (id === undefined) continue
      const resolved = media.get(String(id))
      if (resolved) images.push(resolved)
    }
  }
  const rawVariants = variants.get(String(p.id)) ?? []
  return {
    id: p.id,
    name: String(p.name ?? ''),
    slug: p.slug,
    sku: String(p.sku ?? ''),
    price: Number(p.priceInEGP ?? 0),
    description: p.description ?? undefined,
    trackInventory: p.trackInventory ?? undefined,
    variants: rawVariants.map(projectVariant),
    images,
  }
}

// List published store-products for the tenant (overrideAccess), with optional case-insensitive name
// search and pagination. Returns the projected page plus the filtered total.
export async function listProducts(
  payload: Payload,
  tenantId: number | string,
  opts?: { q?: string; limit?: number; page?: number },
): Promise<{ products: StoreProduct[]; total: number }> {
  const limit = opts?.limit && opts.limit > 0 ? opts.limit : 24
  const page = opts?.page && opts.page > 0 ? opts.page : 1
  const and: Where[] = [
    { tenant: { equals: tenantId } },
    { _status: { equals: 'published' } },
  ]
  const q = opts?.q?.trim()
  if (q) and.push({ name: { contains: q } })
  const { docs, totalDocs } = await payload.find({
    collection: STORE_COLLECTION_SLUGS.products,
    where: { and },
    overrideAccess: true,
    limit,
    page,
    depth: 0,
  })
  const products = docs as RawProduct[]
  const [media, variants] = await Promise.all([
    loadMediaMap(payload, products),
    loadVariantsMap(payload, tenantId, products.map((p) => p.id)),
  ])
  return { products: products.map((p) => project(p, media, variants)), total: totalDocs }
}

// Fetch a single store-product by id OR slug (published, tenant-scoped). Returns null if not found.
export async function getProduct(
  payload: Payload,
  tenantId: number | string,
  idOrSlug: string,
): Promise<StoreProduct | null> {
  const key = String(idOrSlug ?? '')
  const or: Where[] = [{ slug: { equals: key } }]
  if (/^\d+$/.test(key)) or.push({ id: { equals: Number(key) } })
  const { docs } = await payload.find({
    collection: STORE_COLLECTION_SLUGS.products,
    where: {
      and: [
        { tenant: { equals: tenantId } },
        { _status: { equals: 'published' } },
        { or },
      ],
    },
    overrideAccess: true,
    limit: 1,
    depth: 0,
  })
  if (!docs.length) return null
  const p = docs[0] as RawProduct
  const [media, variants] = await Promise.all([
    loadMediaMap(payload, [p]),
    loadVariantsMap(payload, tenantId, [p.id]),
  ])
  return project(p, media, variants)
}

// GET /commerce/store/:tenantSlug/products — query: q, limit (1..100, default 24), page (default 1).
const listHandler = async (req: PayloadRequest): Promise<Response> => {
  const tenantSlug = req.routeParams?.tenantSlug as string | undefined
  if (!tenantSlug) return Response.json({ error: 'missing_tenant' }, { status: 400 })
  const tenant = await resolveStoreTenant(req.payload, tenantSlug)
  if (!tenant) return Response.json({ error: 'not_found' }, { status: 404 })
  const urlBase = process.env.PAYLOAD_PUBLIC_SERVER_URL || 'http://localhost'
  const url = req.url ? new URL(req.url, urlBase) : undefined
  const q = url?.searchParams.get('q') ?? undefined
  const rawLimit = Number(url?.searchParams.get('limit') ?? '')
  const rawPage = Number(url?.searchParams.get('page') ?? '')
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(100, Math.trunc(rawLimit)) : 24
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.trunc(rawPage) : 1
  const { products, total } = await listProducts(req.payload, tenant.id, { q, limit, page })
  return Response.json({ products, total })
}

// GET /commerce/store/:tenantSlug/products/:id — :id may be an id or a slug.
const detailHandler = async (req: PayloadRequest): Promise<Response> => {
  const tenantSlug = req.routeParams?.tenantSlug as string | undefined
  if (!tenantSlug) return Response.json({ error: 'missing_tenant' }, { status: 400 })
  const id = req.routeParams?.id as string | undefined
  const tenant = await resolveStoreTenant(req.payload, tenantSlug)
  if (!tenant) return Response.json({ error: 'not_found' }, { status: 404 })
  const product = await getProduct(req.payload, tenant.id, String(id ?? ''))
  if (!product) return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json(product)
}

export const catalogEndpoints: Endpoint[] = [
  { path: '/commerce/store/:tenantSlug/products', method: 'get', handler: listHandler },
  { path: '/commerce/store/:tenantSlug/products/:id', method: 'get', handler: detailHandler },
]
