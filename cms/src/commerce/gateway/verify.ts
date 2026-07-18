// HMAC-SHA256 verifier for Astro→CMS store requests. Reject-before-parse: the verifier consumes
// raw body bytes and NEVER parses JSON before signature/body validation. All rejections are typed;
// no unstructured throws for the protocol-failure paths. Signature comparison is constant-time.
//
// The verifier is async only because the nonce ledger is async (the SQL repo talks to SQLite). The
// cryptographic work itself is sync.
//
// Order of checks (deliberately: format → crypto → DB):
//   1. all four headers present
//   2. key id matches current or previous
//   3. timestamp is decimal unix seconds
//   4. timestamp within ±300s of server time (boundary inclusive)
//   5. nonce is a lowercase v4 UUID
//   6. signature is exactly 64 lowercase hex
//   7. HMAC over the rebuilt canonical matches (constant-time compare on 32 raw bytes)
//   8. (key_id, nonce_hash) not already in the ledger (replay)
//
// A signature mismatch covers body-byte, method, path, query, and tenant-slug tampering — all of
// those change the canonical string, so the recomputed HMAC differs. The verifier cannot tell which
// field was tampered with; it returns `signature_mismatch` for the whole class.
//
// The verifier returns the URL-derived tenantSlug on success. The route handler resolves that slug
// to a tenant ID and re-reads every cart/order/transaction within that tenant (per §3.2) — the
// signature only authenticates the slug, not the underlying documents.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { bodyHashHex, buildCanonicalPathAndQuery, buildCanonicalString } from './canonical'
import { nonceHash } from './nonce'
import {
  GATEWAY_HEADER_NAMES,
  type KeyMaterial,
  type NonceRepo,
  type VerifyResult,
} from './types'

const TIMESTAMP_WINDOW_SEC = 300
const HEX64 = /^[0-9a-f]{64}$/
const DECIMAL_SECONDS = /^\d+$/
// Strict lowercase v4 UUID: 8-4-4-4-12 hex, version nibble = 4, variant first nibble ∈ {8,9,a,b}.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export interface VerifyInput {
  method: string
  path: string
  query?: string | null
  tenantSlug: string
  bodyBytes: Uint8Array | Buffer
  // Loose header record — anything Node/Payload hands us. Lookups against GATEWAY_HEADER_NAMES are
  // case-insensitive and accept the first value of an array header.
  headers: Record<string, string | string[] | undefined>
  // One or more current keys (the resolver returns one; arrays make multi-instance rotation easier).
  currentKeys: KeyMaterial | KeyMaterial[]
  // Optional previous keys, accepted within the rotation window. Same shape as currentKeys.
  previousKeys?: KeyMaterial | KeyMaterial[]
  now: number | Date
  nonceRepo: NonceRepo
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== lower) continue
    if (Array.isArray(v)) return v[0]
    return v
  }
  return undefined
}

function asKeyList(x: KeyMaterial | KeyMaterial[] | undefined): KeyMaterial[] {
  if (!x) return []
  return Array.isArray(x) ? x : [x]
}

export async function verify(i: VerifyInput): Promise<VerifyResult> {
  const nowSec = typeof i.now === 'number' ? Math.floor(i.now) : Math.floor(i.now.getTime() / 1000)

  // 1. Headers present.
  const keyIdHdr = getHeader(i.headers, GATEWAY_HEADER_NAMES.keyId)
  const timestampHdr = getHeader(i.headers, GATEWAY_HEADER_NAMES.timestamp)
  const nonceHdr = getHeader(i.headers, GATEWAY_HEADER_NAMES.nonce)
  const signatureHdr = getHeader(i.headers, GATEWAY_HEADER_NAMES.signature)
  if (!keyIdHdr || !timestampHdr || !nonceHdr || !signatureHdr) {
    return { ok: false, reason: 'missing_header' }
  }

  // 2. Key id resolves against current + previous candidates.
  const candidates = [...asKeyList(i.currentKeys), ...asKeyList(i.previousKeys)]
  const match = candidates.find((k) => k.keyId === keyIdHdr)
  if (!match) return { ok: false, reason: 'unknown_key_id' }

  // 3. Timestamp format.
  if (!DECIMAL_SECONDS.test(timestampHdr)) {
    return { ok: false, reason: 'malformed_timestamp' }
  }
  const ts = Number(timestampHdr)

  // 4. Timestamp window (boundary inclusive at exactly 300s).
  if (Math.abs(nowSec - ts) > TIMESTAMP_WINDOW_SEC) {
    return { ok: false, reason: 'timestamp_out_of_range' }
  }

  // 5. Nonce format (strict lowercase v4 UUID).
  if (!UUID_V4.test(nonceHdr)) {
    return { ok: false, reason: 'malformed_nonce' }
  }

  // 6. Signature format (exactly 64 lowercase hex).
  if (!HEX64.test(signatureHdr)) {
    return { ok: false, reason: 'malformed_signature' }
  }

  // 7. Constant-time HMAC compare. We rebuild the canonical from request essentials + received body
  //    bytes; any tamper (body, method, path, query, tenant, timestamp, nonce) changes the canonical
  //    and produces signature_mismatch.
  const bodyHash = bodyHashHex(i.bodyBytes)
  const canonical = buildCanonicalString({
    method: i.method,
    pathAndQuery: buildCanonicalPathAndQuery(i.path, i.query),
    tenantSlug: i.tenantSlug,
    timestamp: ts,
    nonce: nonceHdr,
    bodyHash,
  })
  const expected = createHmac('sha256', match.secret).update(canonical, 'utf8').digest()
  const received = Buffer.from(signatureHdr, 'hex')
  // Both buffers are exactly 32 bytes here (HEX64 + sha256), so timingSafeEqual cannot throw on a
  // length mismatch. The length guard is structural, not a side-channel an attacker can probe: an
  // attacker who controls the header already gets a 400-series rejection regardless.
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return { ok: false, reason: 'signature_mismatch' }
  }

  // 8. Replay protection. Insert AFTER a valid signature, BEFORE business work. A failed business
  //    op still consumes the nonce (the row stays in the ledger).
  const ins = await i.nonceRepo.tryInsert({
    keyId: match.keyId,
    nonceHash: nonceHash(nonceHdr),
    nowSec,
  })
  if (!ins.inserted) return { ok: false, reason: 'replay' }

  return { ok: true, tenantSlug: i.tenantSlug }
}
