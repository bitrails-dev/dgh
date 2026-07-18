// Commerce crypto. Two responsibilities, both reusing node `crypto` stdlib under HKDF-isolated
// purposes so commerce key material is cryptographically independent from social OAuth tokens:
//   1. Gateway-secret encryption (AES-256-GCM via social/crypto under purpose `payload-commerce`).
//      Plaintext gateway secrets are never returned after save.
//   2. Stateless customer session tokens (HMAC-SHA256 under purpose `payload-commerce-session`),
//      signed + expiring + constant-time verified — mirrors social/crypto signState/verifyState.
//      Stateless → no DB session row and no server-side revocation (logout clears the cookie; a
//      short TTL bounds exposure). A revocation list is deferred.

import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import { decryptToken, encryptToken } from '../social/crypto'

const PURPOSE = 'payload-commerce'
const SESSION_PURPOSE = 'payload-commerce-session'

export function encryptGatewaySecret(plaintext: string): string {
  return encryptToken(plaintext, undefined, PURPOSE)
}

export function decryptGatewaySecret(blob: string): string {
  return decryptToken(blob, undefined, PURPOSE)
}

// --- Stateless customer session tokens ---------------------------------------

const sessionKey = (): Buffer =>
  Buffer.from(hkdfSync('sha256', process.env.PAYLOAD_SECRET || '', SESSION_PURPOSE, 'session-v1', 32))

export interface SessionPayload {
  customerId: number | string
  tenantId?: number | string
  exp: number
}

export function signSession(p: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url')
  const mac = createHmac('sha256', sessionKey()).update(body).digest('base64url')
  return `${body}.${mac}`
}

export function verifySession(token: string): SessionPayload {
  const sep = token.lastIndexOf('.')
  const body = token.slice(0, sep)
  const mac = token.slice(sep + 1)
  if (!body || !mac) throw new Error('Malformed session token.')
  const expected = createHmac('sha256', sessionKey()).update(body).digest()
  const got = Buffer.from(mac, 'base64url')
  // Constant-time compare; the length guard prevents throwing inside timingSafeEqual.
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw new Error('Invalid session signature.')
  }
  let p: SessionPayload
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
  } catch {
    throw new Error('Malformed session payload.')
  }
  if (typeof p.exp !== 'number' || Date.now() > p.exp) throw new Error('Session expired.')
  return p
}
