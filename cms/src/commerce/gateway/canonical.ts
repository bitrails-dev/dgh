// §4.1 canonical string builder. Pure, deterministic, no I/O. Both Astro signer and CMS verifier
// call this exact function so they cannot drift on field order, casing, or separators.
//
// Canonical string (fields separated by ONE ASCII LF 0x0A, NO trailing LF):
//
//   v1
//   <UPPERCASE_METHOD>
//   <CANONICAL_CMS_PATH_AND_QUERY>
//   <LOWERCASE_TENANT_SLUG>
//   <DECIMAL_UNIX_SECONDS>
//   <LOWERCASE_UUID_V4_NONCE>
//   <LOWERCASE_SHA256_HEX_OF_EXACT_BODY_BYTES>
//
// "CANONICAL" path-and-query means the string Astro and CMS agree on ahead of time: a stable URL
// path and a stable query string. The gateway does NOT re-encode, re-sort, or otherwise normalize
// query parameters — both sides must produce byte-identical `path` and `query` inputs. URL encoding
// is the caller's responsibility.

import { createHash } from 'node:crypto'

// SHA-256 hex of the EXACT body bytes. Used both by the signer (over the bytes it sends) and by the
// verifier (over the raw bytes it received, before any JSON parse). Lowercase hex, 64 chars.
export function bodyHashHex(bodyBytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bodyBytes).digest('hex')
}

// Combine path and query into the canonical path-and-query field. Empty/undefined query → path
// only; otherwise `path + '?' + query`. No normalization is performed on either input.
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
