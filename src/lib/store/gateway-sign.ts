// Astro-side commerce gateway signer (Plan §4.1). Mirrors cms/src/commerce/gateway/{canonical,sign}.ts
// byte-for-byte: the CMS verifier (withVerifiedCommerceGateway → verify()) recomputes the SAME
// canonical string + HMAC-SHA256, so the two sides agree as long as the pinned vectors in
// cms/tests/commerce-gateway.test.ts (VECTOR A/B) pass on both. Astro signs with the CURRENT key
// only; CMS accepts current + optional previous (rotation). Pure node:crypto — no I/O, no fetch.
//
// The secret (COMMERCE_GATEWAY_SECRET) is server-only: this module runs in the Astro SSR (Node
// standalone adapter), never in the browser. The browser client (src/components/shop/api.ts) calls
// same-origin /api/store/v2/* and never signs.

import { createHash, createHmac, randomUUID } from 'node:crypto'

// Header names are stable across Astro and CMS (cms/src/commerce/gateway/types.ts). Verifier lookup
// is case-insensitive, but we emit the canonical casing.
export const GATEWAY_HEADER_NAMES = {
  keyId: 'X-Commerce-Gateway-Key-Id',
  timestamp: 'X-Commerce-Gateway-Timestamp',
  nonce: 'X-Commerce-Gateway-Nonce',
  signature: 'X-Commerce-Gateway-Signature',
} as const

// SHA-256 hex of the EXACT body bytes the proxy forwards. Lowercase, 64 chars.
export function bodyHashHex(body: Uint8Array | Buffer): string {
  return createHash('sha256').update(body).digest('hex')
}

// path + '?' + query when query is non-empty; path only otherwise. No normalization (both sides must
// pass byte-identical path/query — the proxy builds the CMS path+query and signs that exact form).
export function buildCanonicalPathAndQuery(path: string, query?: string | null): string {
  if (query === undefined || query === null || query === '') return path
  return `${path}?${query}`
}

export interface CanonicalInput {
  method: string
  pathAndQuery: string
  tenantSlug: string
  timestamp: number // unix seconds
  nonce: string // lowercase v4 UUID
  bodyHash: string // lowercase sha256 hex
}

// 7 LF-separated fields, NO trailing LF: v1 / METHOD / pathAndQuery / tenant / timestamp / nonce / bodyHash.
export function buildCanonicalString(i: CanonicalInput): string {
  return [
    'v1',
    i.method.toUpperCase(),
    i.pathAndQuery,
    i.tenantSlug.toLowerCase(),
    String(i.timestamp),
    i.nonce.toLowerCase(),
    i.bodyHash.toLowerCase(),
  ].join('\n')
}

export interface SignInput {
  method: string
  /** CMS path (the path the verifier sees), e.g. /api/commerce/store/acme/cart. */
  path: string
  query?: string | null
  tenantSlug: string
  body: Uint8Array | Buffer
  now: number | Date
  nonce?: string // defaults to a fresh lowercase v4 UUID
  keyId: string
  secret: Uint8Array
}

export interface SignOutput {
  keyId: string
  timestamp: string
  nonce: string
  signature: string
  /** Wire headers ready to merge into the outbound fetch. */
  headers: Record<string, string>
}

export function sign(i: SignInput): SignOutput {
  const timestamp =
    typeof i.now === 'number' ? Math.floor(i.now) : Math.floor(i.now.getTime() / 1000)
  const nonce = (i.nonce ?? randomUUID()).toLowerCase()
  const bodyHash = bodyHashHex(i.body)
  const canonical = buildCanonicalString({
    method: i.method,
    pathAndQuery: buildCanonicalPathAndQuery(i.path, i.query),
    tenantSlug: i.tenantSlug,
    timestamp,
    nonce,
    bodyHash,
  })
  const signature = createHmac('sha256', i.secret).update(canonical, 'utf8').digest('hex')
  const timestampStr = String(timestamp)
  return {
    keyId: i.keyId,
    timestamp: timestampStr,
    nonce,
    signature,
    headers: {
      [GATEWAY_HEADER_NAMES.keyId]: i.keyId,
      [GATEWAY_HEADER_NAMES.timestamp]: timestampStr,
      [GATEWAY_HEADER_NAMES.nonce]: nonce,
      [GATEWAY_HEADER_NAMES.signature]: signature,
    },
  }
}
