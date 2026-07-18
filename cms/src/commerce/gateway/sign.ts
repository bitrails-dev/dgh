// HMAC-SHA256 signer for Astro→CMS store requests. Pure: takes a key and request essentials,
// returns the signature and the four wire headers. The same `buildCanonicalString` is used by the
// verifier, so a sign/verify round-trip is byte-identical by construction.
//
// Astro signs with the CURRENT key only (per §4.1). CMS accepts current + optional previous.
//
// `now` accepts a Date or unix seconds for testability. `nonce` defaults to a fresh crypto.randomUUID
// (already lowercase v4); tests pass an explicit nonce to assert deterministic output.

import { createHmac, randomUUID } from 'node:crypto'
import { bodyHashHex, buildCanonicalPathAndQuery, buildCanonicalString } from './canonical'
import { GATEWAY_HEADER_NAMES, type StructuredGatewayHeaders } from './types'

export interface SignInput {
  method: string
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
  timestamp: string // decimal unix seconds
  nonce: string // lowercase v4 UUID
  signature: string // 64 lowercase hex
  // Wire headers ready to merge into a fetch/Request Headers. Keys are the canonical header names.
  headers: Record<string, string>
  // Same values as the structured 4-tuple, for callers that want to read them by name.
  structured: StructuredGatewayHeaders
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
  const structured: StructuredGatewayHeaders = {
    keyId: i.keyId,
    timestamp: timestampStr,
    nonce,
    signature,
  }
  return {
    keyId: i.keyId,
    timestamp: timestampStr,
    nonce,
    signature,
    structured,
    headers: {
      [GATEWAY_HEADER_NAMES.keyId]: i.keyId,
      [GATEWAY_HEADER_NAMES.timestamp]: timestampStr,
      [GATEWAY_HEADER_NAMES.nonce]: nonce,
      [GATEWAY_HEADER_NAMES.signature]: signature,
    },
  }
}
