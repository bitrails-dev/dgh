// Public catalog endpoints (GET /api/commerce/store/:tenantSlug/products[/:id]). The HTTP route is a
// thin handler over directly-callable orchestration (listProducts / getProduct), mirroring the
// payments/webhook pattern: tenant resolved by URL slug → 404 for an unknown tenant or one lacking
// the `commerce` feature. Products are loaded server-side with overrideAccess and projected to a
// storefront shape; client-supplied prices are never trusted (this surface is read-only).
//
// Images are stored on the product as a JSON array of `media` document IDs; we resolve them with ONE
// batched media `find` (`id in [...]`) per request and skip any dead/missing ID. Media URLs are made
// absolute against PAYLOAD_PUBLIC_SERVER_URL so the storefront can render them directly.
import type { Endpoint, Payload, PayloadRequest, Where } from 'payload'
import { resolveStoreTenant } from './shared'

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
  name?: string
  slug?: string
  sku?: string
  description?: string
  price?: number
  compareAtPrice?: number | null
  productKind?: string
  trackInventory?: boolean
  images?: unknown[] | null
  variants?: unknown[] | null
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

// One batched media fetch per request builds an id→image map; dead IDs simply never appear in it.
async function loadMediaMap(payload: Payload, products: RawProduct[]): Promise<Map<string, StoreImage>> {
  const ids = new Set<string>()
  for (const p of products) {
    if (Array.isArray(p.images)) {
      for (const mid of p.images) {
        if (mid !== null && mid !== undefined) ids.add(String(mid))
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

// Project a raw product row to the storefront shape; variants pass through verbatim (pricing is
// resolved server-side elsewhere). Unresolved image IDs are silently dropped.
function project(p: RawProduct, media: Map<string, StoreImage>): StoreProduct {
  const images: StoreImage[] = []
  if (Array.isArray(p.images)) {
    for (const mid of p.images) {
      const resolved = media.get(String(mid))
      if (resolved) images.push(resolved)
    }
  }
  return {
    id: p.id,
    name: String(p.name ?? ''),
    slug: p.slug,
    sku: String(p.sku ?? ''),
    price: Number(p.price ?? 0),
    compareAtPrice: p.compareAtPrice != null ? Number(p.compareAtPrice) : undefined,
    description: p.description,
    productKind: p.productKind,
    trackInventory: p.trackInventory,
    variants: Array.isArray(p.variants) ? p.variants : [],
    images,
  }
}

// List ACTIVE products for the tenant (overrideAccess), with optional case-insensitive name search
// and pagination. Returns the projected page plus the filtered total.
export async function listProducts(
  payload: Payload,
  tenantId: number | string,
  opts?: { q?: string; limit?: number; page?: number },
): Promise<{ products: StoreProduct[]; total: number }> {
  const limit = opts?.limit && opts.limit > 0 ? opts.limit : 24
  const page = opts?.page && opts.page > 0 ? opts.page : 1
  const and: Where[] = [
    { tenant: { equals: tenantId } },
    { status: { equals: 'active' } },
  ]
  const q = opts?.q?.trim()
  if (q) and.push({ name: { contains: q } })
  const { docs, totalDocs } = await payload.find({
    collection: 'products',
    where: { and },
    overrideAccess: true,
    limit,
    page,
  })
  const media = await loadMediaMap(payload, docs as RawProduct[])
  const products = (docs as RawProduct[]).map((p) => project(p, media))
  return { products, total: totalDocs }
}

// Fetch a single product by id OR slug (active, tenant-scoped). Returns null if not found.
export async function getProduct(
  payload: Payload,
  tenantId: number | string,
  idOrSlug: string,
): Promise<StoreProduct | null> {
  const key = String(idOrSlug ?? '')
  const or: Where[] = [{ slug: { equals: key } }]
  if (/^\d+$/.test(key)) or.push({ id: { equals: Number(key) } })
  const { docs } = await payload.find({
    collection: 'products',
    where: {
      and: [
        { tenant: { equals: tenantId } },
        { status: { equals: 'active' } },
        { or },
      ],
    },
    overrideAccess: true,
    limit: 1,
  })
  if (!docs.length) return null
  const p = docs[0] as RawProduct
  const media = await loadMediaMap(payload, [p])
  return project(p, media)
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
