// Nonce hashing + an in-memory ledger for tests. The SQL-backed NonceRepo that the integration
// owner wires to the `commerce-gateway-nonces` table lives outside this module — the table is
// created by the C1 migration lane and this agent must not define it.
//
// We hash the raw v4 UUID nonce with SHA-256 so (a) the unique index covers a fixed 64-char field
// regardless of UUID formatting, and (b) the ledger never stores the raw nonce value (defense in
// depth — UUIDs are not secret, but the schema calls for SHA-256 nonce_hash, so we honor that).

import { createHash } from 'node:crypto'
import type { NonceRepo } from './types'

export function nonceHash(nonce: string): string {
  return createHash('sha256').update(nonce, 'utf8').digest('hex')
}

// In-memory NonceRepo for unit tests. Unique per instance — every test that needs replay semantics
// shares one; every other test gets a fresh one. NOT for production: it grows unbounded and is
// per-process. The SQL repo is the production path.
export class InMemoryNonceRepo implements NonceRepo {
  private readonly store = new Set<string>()

  async tryInsert(input: {
    keyId: string
    nonceHash: string
    nowSec: number
  }): Promise<{ inserted: boolean }> {
    const key = `${input.keyId}|${input.nonceHash}`
    if (this.store.has(key)) return { inserted: false }
    this.store.add(key)
    return { inserted: true }
  }

  // Test helper: number of nonces currently held.
  get size(): number {
    return this.store.size
  }
}
