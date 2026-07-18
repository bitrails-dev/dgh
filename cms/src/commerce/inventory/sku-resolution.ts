// Plugin-first SKU resolution for the retained Phase 1 inventory layer.
//
// Plan §1.3 + §3.4 + Wave C5. The ecommerce plugin owns base products/variants under the
// collision-free `store-*` slugs (Wave B4). Phase 1 inventory continues to reserve by IMMUTABLE SKU
// (the atomic conditional UPDATE in inventory/index.ts is unchanged); this module is the adapter that
// turns a (tenant, SKU) into the plugin sellable document so callers can:
//
//   1. verify the SKU actually exists in the tenant's catalog before attempting a reservation;
//   2. carry plugin document IDs alongside the reservation for traceability — the order snapshot,
//      stock_movement metadata, or any other audit surface the caller chooses.
//
// What this module DOES NOT do:
//   - change reservation invariants (SKU remains the allocation key);
//   - add a metadata column to `stock_reservations` (Phase 1 schema is frozen);
//   - bypass tenant scoping (the loader always filters by tenant);
//   - consult inventory levels (that is Phase 1's job).
//
// To keep tests green before the Wave C1 migration creates the `store-products` / `store-variants`
// tables, the loader is injectable. The default loader talks to Payload's Local API; unit tests pass
// a fake loader and never touch the database. The integration owner wires the default loader into
// checkout/quote flows once C1 lands; until then, callers that need plugin-aware resolution must
// inject their own loader or skip the call site.

import type { Payload } from 'payload'

import { STORE_COLLECTION_SLUGS } from '../plugin/slugs'

export type SellableKind = 'product' | 'variant'

export interface ResolvedSellable {
  /** 'product' for a simple product with a product-level SKU; 'variant' for a variant SKU. */
  kind: SellableKind
  /** Normalized (trimmed + uppercased) SKU — the immutable inventory allocation key. */
  sku: string
  /** Plugin `store-products` document ID owning this SKU. Always set. */
  productId: number | string
  /**
   * Plugin `store-variants` document ID. Set only when `kind === 'variant'`. For a simple product
   * this is null; the product-level SKU is the allocation key.
   */
  variantId: number | string | null
  /** Echo of the product's `trackInventory` flag (default true). Reservation callers SHOULD honor it. */
  trackInventory: boolean
}

export type SkuResolutionResult =
  | { ok: true; sellable: ResolvedSellable }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID' }

/**
 * Normalized candidate doc as the loader returns it. The loader is responsible for tenant scoping;
 * the resolver trusts the loader's tenant filter and only chooses between product/variant kinds.
 */
export interface SellableCandidate {
  kind: SellableKind
  /** Plugin document ID of the product or variant row. */
  id: number | string
  /** For a variant candidate: the parent `store-products` ID. Required when `kind === 'variant'`. */
  productId?: number | string
  /** Raw SKU as stored on the document (the resolver normalizes before comparing). */
  sku?: string | null
  /** Whether the sellable should reserve stock. Defaults to true when absent. */
  trackInventory?: boolean | null
}

/**
 * Tenant-scoped loader. Given a normalized SKU and a tenant ID, return every candidate that matches
 * (across `store-products` and `store-variants`). The resolver picks the unique winner.
 *
 * Implementations MUST filter by tenant; the resolver does not re-check. The default loader issues
 * two Payload Local API finds (variants first, then products) constrained by `tenant: { equals }`.
 */
export type SellableLoader = (
  tenantId: number | string,
  normalizedSku: string,
) => Promise<SellableCandidate[]>

/** Normalize a raw SKU to the immutable allocation key: trim + ASCII uppercase. */
export function normalizeSku(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase()
}

/**
 * Default loader: queries the ecommerce plugin's `store-variants` and `store-products` collections
 * via Payload Local API, scoped to a single tenant. Returns variant matches first so a variant SKU
 * resolves to its variant document (not the parent product). Honors the multi-tenant plugin's
 * `tenant` relationship field (the column is `tenant_id`; the Local API filter name is `tenant`).
 *
 * Returns at most one candidate per collection; if a collection has duplicate SKUs for the tenant
 * (which the Wave C1 unique index forbids), the first hit is returned and the duplication is the
 * migration's problem to clean up.
 */
export function createDefaultSellableLoader(payload: Payload): SellableLoader {
  return async (tenantId, normalizedSku) => {
    const candidates: SellableCandidate[] = []

    // Variants first — variant SKUs are required and uniquely identify the variant row.
    try {
      const v = await payload.find({
        collection: STORE_COLLECTION_SLUGS.variants,
        where: { and: [{ tenant: { equals: tenantId } }, { sku: { equals: normalizedSku } }] },
        overrideAccess: true,
        limit: 1,
      })
      for (const doc of v.docs as unknown as Array<Record<string, unknown>>) {
        const productRef = doc.parent
          ?? doc.product
          ?? doc.productId
          ?? null
        candidates.push({
          kind: 'variant',
          id: doc.id as number | string,
          productId: (productRef as number | string | undefined) ?? undefined,
          sku: typeof doc.sku === 'string' ? doc.sku : null,
          trackInventory:
            typeof doc.trackInventory === 'boolean' ? doc.trackInventory : doc.trackInventory == null ? true : Boolean(doc.trackInventory),
        })
      }
    } catch {
      // The plugin collection may not exist yet (pre-C1). Treat as empty; the resolver will fall
      // through to products, then return NOT_FOUND. The integration owner's C1 wiring removes this
      // ambiguity by ensuring the table exists before the default loader is used in production.
    }

    // Simple products with a product-level SKU (null for variant products per Plan §3.4).
    try {
      const p = await payload.find({
        collection: STORE_COLLECTION_SLUGS.products,
        where: { and: [{ tenant: { equals: tenantId } }, { sku: { equals: normalizedSku } }] },
        overrideAccess: true,
        limit: 1,
      })
      for (const doc of p.docs as unknown as Array<Record<string, unknown>>) {
        candidates.push({
          kind: 'product',
          id: doc.id as number | string,
          sku: typeof doc.sku === 'string' ? doc.sku : null,
          trackInventory:
            typeof doc.trackInventory === 'boolean' ? doc.trackInventory : doc.trackInventory == null ? true : Boolean(doc.trackInventory),
        })
      }
    } catch {
      // Same pre-C1 tolerance as above.
    }

    return candidates
  }
}

/**
 * Resolve a (tenant, SKU) to a single plugin sellable document.
 *
 * Order of preference:
 *   1. An exact variant SKU match (variants are the canonical allocation unit).
 *   2. An exact simple-product SKU match (product carries its own SKU when it has no variants).
 *
 * The SKU is normalized (trim + uppercase) before lookup so a browser-supplied lowercase or
 * whitespace-padded SKU still hits a stored normalized SKU. The normalized form is the only form
 * that should ever be passed to `reserve()` — callers SHOULD use `sellable.sku`, not the raw input.
 */
export async function resolveSellableBySku(input: {
  payload?: Payload
  tenantId: number | string
  sku: string
  loader?: SellableLoader
}): Promise<SkuResolutionResult> {
  const { tenantId, sku } = input
  if (typeof sku !== 'string' || sku.length === 0) {
    return { ok: false, code: 'INVALID' }
  }
  const normalized = normalizeSku(sku)
  if (normalized.length === 0) {
    return { ok: false, code: 'INVALID' }
  }

  const injected: SellableLoader | undefined = input.loader
  const loader: SellableLoader | undefined =
    injected ?? (input.payload ? createDefaultSellableLoader(input.payload) : undefined)
  if (!loader) {
    // No payload and no injected loader — nothing the resolver can do. Caller bug.
    return { ok: false, code: 'INVALID' }
  }

  const candidates = await loader(tenantId, normalized)

  // Prefer variant matches; a SKU is either a variant SKU or a simple-product SKU, never both
  // (the Wave C1 unique indexes forbid duplicates within a tenant, and a variant product has a null
  // product-level SKU by §3.4). If somehow both exist, the variant wins because variants are the
  // canonical allocation unit.
  const variant = candidates.find((c) => c.kind === 'variant' && normalizeSku(c.sku) === normalized)
  if (variant) {
    if (variant.productId == null) {
      // A variant candidate without a parent product reference cannot be traced back; treat as
      // unresolved so the caller surfaces the data error rather than carrying an orphan ID.
      return { ok: false, code: 'NOT_FOUND' }
    }
    return {
      ok: true,
      sellable: {
        kind: 'variant',
        sku: normalized,
        productId: variant.productId,
        variantId: variant.id,
        trackInventory: variant.trackInventory ?? true,
      },
    }
  }

  const product = candidates.find((c) => c.kind === 'product' && normalizeSku(c.sku) === normalized)
  if (product) {
    return {
      ok: true,
      sellable: {
        kind: 'product',
        sku: normalized,
        productId: product.id,
        variantId: null,
        trackInventory: product.trackInventory ?? true,
      },
    }
  }

  return { ok: false, code: 'NOT_FOUND' }
}

/**
 * Convenience: resolve many SKUs in one tenant. Used by checkout/quote to batch-verify a cart's
 * lines. Returns the first failure (preserving the resolver's NOT_FOUND code) or the full map of
 * normalized-SKU → ResolvedSellable on success.
 */
export async function resolveSellablesBySku(input: {
  payload?: Payload
  tenantId: number | string
  skus: string[]
  loader?: SellableLoader
}): Promise<
  | { ok: true; sellables: Map<string, ResolvedSellable> }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID'; sku?: string }
> {
  if (!Array.isArray(input.skus) || input.skus.length === 0) {
    return { ok: false, code: 'INVALID' }
  }
  const sellables = new Map<string, ResolvedSellable>()
  for (const raw of input.skus) {
    const r = await resolveSellableBySku({
      payload: input.payload,
      tenantId: input.tenantId,
      sku: raw,
      loader: input.loader,
    })
    if (!r.ok) return { ok: false, code: r.code, sku: raw }
    sellables.set(r.sellable.sku, r.sellable)
  }
  return { ok: true, sellables }
}
