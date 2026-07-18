// Shared types and constants for the retained commerce gateway boundary.
//
// The gateway signs Astro→CMS store requests with HMAC-SHA256 over a fixed canonical string
// (§4.1). CMS verifies before any JSON parsing or business work. See canonical.ts for the exact
// wire format and verify.ts for the rejection rules.
//
// Integration owner wires:
//   - `verify()` into the signed store endpoints (cms/src/commerce/store/endpoints.ts) and into
//     Paymob/Kashier adapter functions (cms/src/commerce/payments/{endpoints,adapters/*}.ts).
//   - `resolveKeysFromEnv()` to read COMMERCE_GATEWAY_* at request time.
//   - A SQL-backed NonceRepo to the `commerce-gateway-nonces` table created by the C1 migration.
//
// This module owns NO route, env file, migration, or table definition.

// Header names are stable across Astro and CMS. Lookups performed by verify() are case-insensitive.
export const GATEWAY_HEADER_NAMES = {
  keyId: 'X-Commerce-Gateway-Key-Id',
  timestamp: 'X-Commerce-Gateway-Timestamp',
  nonce: 'X-Commerce-Gateway-Nonce',
  signature: 'X-Commerce-Gateway-Signature',
} as const

// Raw key material — keyId is the wire identifier; secret is the decoded ≥32 random bytes used as
// the HMAC-SHA256 key. Producer: keys.ts::resolveKeysFromEnv. Consumer: sign.ts, verify.ts.
export interface KeyMaterial {
  keyId: string
  secret: Uint8Array
}

// Structured 4-tuple of wire header values, used by tests and any caller that wants to read the
// headers it just produced without re-looking-up by name.
export interface StructuredGatewayHeaders {
  keyId: string
  timestamp: string
  nonce: string
  signature: string
}

// Nonce ledger repository. The integration owner wires this to the `commerce-gateway-nonces` table
// (columns: id, key_id, nonce_hash, created_at, expires_at; unique (key_id, nonce_hash)) created by
// the C1 migration lane. The verifier calls tryInsert() AFTER a valid signature and BEFORE business
// work; a failed business operation still consumes the nonce (the row stays), so a retry must use a
// fresh nonce plus the existing checkout idempotency key.
//
// `nonceHash` is SHA-256 hex of the raw v4 UUID nonce (see nonce.ts). `nowSec` is unix seconds; the
// SQL repo sets created_at/expires_at and prunes expired rows in the scheduled commerce sweep.
export interface NonceRepo {
  tryInsert(input: {
    keyId: string
    nonceHash: string
    nowSec: number
  }): Promise<{ inserted: boolean }>
}

// Typed verifier outcome. Every rejection carries a machine-readable reason; the integration owner
// maps {ok:false, reason} to a 403 (or 401 for missing/unknown key) and never proceeds to business
// work. `{ok:true, tenantSlug}` returns the URL-derived tenant slug, now verified against the
// signature — the route handler resolves it to a tenant ID for the Local API call.
export type VerifyOk = { ok: true; tenantSlug: string }
export type VerifyReason =
  // One or more of the four gateway headers missing.
  | 'missing_header'
  // Key id does not match current or any previous key.
  | 'unknown_key_id'
  // Timestamp header is not decimal unix seconds.
  | 'malformed_timestamp'
  // Timestamp is more than 300s away from server time (past or future).
  | 'timestamp_out_of_range'
  // Nonce header is not a lowercase v4 UUID.
  | 'malformed_nonce'
  // Signature header is not exactly 64 lowercase hex characters.
  | 'malformed_signature'
  // Signature is well-formed but does not match the recomputed HMAC. Covers body-byte, method,
  // path, query, and tenant-slug tampering (all manifest as canonical-string mismatch).
  | 'signature_mismatch'
  // (key_id, nonce_hash) already present in the ledger — the request is a replay.
  | 'replay'
export type VerifyResult = VerifyOk | { ok: false; reason: VerifyReason }
