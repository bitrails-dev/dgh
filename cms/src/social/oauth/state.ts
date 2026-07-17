// One-time, expiring, HMAC-signed OAuth state (Task D/E). `createOAuthState` stores a SHA-256 of a
// random nonce (never the nonce itself) with an expiry; `consumeOAuthState` verifies the signature
// (crypto.verifyState) AND that the nonce hash exists + is unconsumed, then marks it consumed — so a
// captured state is useless after one use. Pure over an injected PayloadLike → unit-testable.
import { createHash, randomBytes } from 'node:crypto'
import { signState, verifyState } from '../crypto'
import type { PayloadLike } from '../job'
import type { Platform } from '../types'

const STATE_TTL_MS = 5 * 60 * 1000 // 5 minutes

const hashNonce = (nonce: string): string => createHash('sha256').update(nonce).digest('hex')

const and = (...clauses: unknown[]) => ({ and: clauses })

export async function createOAuthState(
  payload: PayloadLike,
  opts: { tenantId: number | string; platform: Platform; returnTo?: string; codeVerifier?: string; now?: () => number },
): Promise<string> {
  const now = opts.now ?? Date.now
  const exp = now() + STATE_TTL_MS
  const nonce = randomBytes(16).toString('hex')
  await payload.create({
    collection: 'social-oauth-states',
    data: {
      nonceHash: hashNonce(nonce),
      tenant: opts.tenantId,
      platform: opts.platform,
      expiresAt: new Date(exp).toISOString(),
      consumedAt: null,
      codeVerifier: opts.codeVerifier ?? null,
    },
    overrideAccess: true,
  })
  return signState({ tenantId: opts.tenantId, platform: opts.platform, nonce, exp, returnTo: opts.returnTo })
}

export type ConsumedState = { tenantId: number | string; platform: Platform; returnTo?: string; codeVerifier?: string }

export async function consumeOAuthState(payload: PayloadLike, token: string): Promise<ConsumedState> {
  // Throws on bad signature / expired / malformed.
  const p = verifyState(token)
  const found = await payload.find({
    collection: 'social-oauth-states',
    where: and(
      { nonceHash: { equals: hashNonce(p.nonce) } },
      { tenant: { equals: p.tenantId } },
      { platform: { equals: p.platform } },
    ),
    overrideAccess: true,
    limit: 1,
  })
  const row = found.docs[0]
  if (!row) throw new Error('Unknown OAuth state.')
  if (row.consumedAt) throw new Error('OAuth state already used (possible replay).')
  await payload.update({
    collection: 'social-oauth-states',
    id: row.id as number | string,
    data: { consumedAt: new Date().toISOString() },
    overrideAccess: true,
  })
  return { tenantId: p.tenantId, platform: p.platform as Platform, returnTo: p.returnTo, codeVerifier: row.codeVerifier as string | undefined }
}
