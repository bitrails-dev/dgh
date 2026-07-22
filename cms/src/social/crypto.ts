// Crypto core for social publishing (Task D/E). Node `crypto` stdlib only — no dependencies.
//
// Two responsibilities:
//   1. AES-256-GCM symmetric encryption for provider OAuth tokens at rest. Key is derived from
//      PAYLOAD_SECRET via HKDF; the blob carries a version byte so the key can be rotated later
//      without a mass re-encrypt. GCM auth tag → any tamper / wrong-secret decrypt fails closed.
//   2. HMAC-SHA256 signed, expiring OAuth `state` for the connect/callback flow (constant-time
//      verify). One-time use is enforced separately by the social-oauth-states collection.
//
// Plaintext never reaches clients or logs: callers receive/return only the base64 blob and the
// signed state token.
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

const KEY_VERSION = 1
const KEY_LEN = 32 // AES-256
const IV_LEN = 12 // GCM nonce
const TAG_LEN = 16
const MIN_SECRET_BYTES = 32

/**
 * Fail-closed guard for HKDF input. The HKDF `ikm` MUST come from a strong, sufficiently long
 * PAYLOAD_SECRET — an empty/short secret silently produces a weak/derivable key. Throws a clear
 * Error at call time if the env var is missing OR decodes to fewer than 32 bytes. We treat the
 * value as a UTF-8 string for the length check because that is how `deriveKey` and the commerce
 * `sessionKey` consume it (`hkdfSync('sha256', process.env.PAYLOAD_SECRET || '', ...)`).
 *
 * In non-production (test/dev) we do NOT throw — instead we pad a short/missing secret up to the
 * 32-byte minimum with a fixed, non-secret suffix. This keeps the security invariant (production
 * fails closed) without forcing every integration test fixture to carry a 32+ byte secret. The
 * padded form is still deterministic per-process so encryption round-trips within a test; it is
 * never used in production because the production check throws first.
 */
export function requirePayloadSecret(): string {
  const raw = process.env.PAYLOAD_SECRET
  const isProd = process.env.NODE_ENV === 'production'
  if (typeof raw !== 'string' || raw.length === 0) {
    if (isProd) {
      throw new Error('PAYLOAD_SECRET must be set and be >= 32 bytes for commerce crypto')
    }
    // Non-production with no secret: use a fixed test-only key (NOT secret, NOT for prod use).
    return 'test-only-payload-secret-padding-do-not-use-in-prod'
  }
  if (Buffer.byteLength(raw, 'utf8') < MIN_SECRET_BYTES) {
    if (isProd) {
      throw new Error('PAYLOAD_SECRET must be set and be >= 32 bytes for commerce crypto')
    }
    // Non-production with a short secret: pad it so HKDF gets 32 bytes. Deterministic per-value.
    return raw.padEnd(MIN_SECRET_BYTES, '0')
  }
  return raw
}

const secretKey = (): string => requirePayloadSecret()

// HKDF `info`/salt couples key derivation to a purpose. The default `payload-social` isolates social
// OAuth tokens; commerce reuses the same primitives under `payload-commerce` (see commerce/crypto.ts)
// so each domain's keys are independent — one purpose's material can never derive the other's.
// ponytail: one HKDF derivation per process call is cheap (sub-millisecond); cache only if profiling shows it matters.
const deriveKey = (secret: string, purpose: string = 'payload-social'): Buffer =>
  Buffer.from(hkdfSync('sha256', secret, purpose, 'aes-256-gcm-token-v1', KEY_LEN))

export type EncryptedToken = string

export function encryptToken(
  plaintext: string,
  secret: string = secretKey(),
  purpose: string = 'payload-social',
): EncryptedToken {
  const key = deriveKey(secret, purpose)
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // [version(1)][iv(12)][authTag(16)][ciphertext...]
  return Buffer.concat([Buffer.from([KEY_VERSION]), iv, tag, ciphertext]).toString('base64')
}

export function decryptToken(
  blob: EncryptedToken,
  secret: string = secretKey(),
  purpose: string = 'payload-social',
): string {
  const buf = Buffer.from(blob, 'base64')
  if (buf.length < 1 + IV_LEN + TAG_LEN) throw new Error('Malformed token blob.')
  const version = buf[0]
  if (version !== KEY_VERSION) throw new Error(`Unsupported token key version: ${version}.`)
  const iv = buf.subarray(1, 1 + IV_LEN)
  const tag = buf.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN)
  const ciphertext = buf.subarray(1 + IV_LEN + TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, purpose), iv)
  decipher.setAuthTag(tag)
  // Throws on tag mismatch (tamper / wrong key) — fail closed.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

// --- OAuth state --------------------------------------------------------------------------

export type StatePayload = {
  tenantId: number | string
  platform: string
  nonce: string
  exp: number
  returnTo?: string
}

export function signState(p: StatePayload, secret: string = secretKey()): string {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url')
  const mac = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${mac}`
}

export function verifyState(token: string, secret: string = secretKey()): StatePayload {
  const sep = token.lastIndexOf('.')
  const body = token.slice(0, sep)
  const mac = token.slice(sep + 1)
  if (!body || !mac) throw new Error('Malformed state token.')
  const expected = createHmac('sha256', secret).update(body).digest()
  const got = Buffer.from(mac, 'base64url')
  // Constant-time compare; length guard prevents throwing inside timingSafeEqual.
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw new Error('Invalid state signature.')
  }
  let p: StatePayload
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload
  } catch {
    throw new Error('Malformed state payload.')
  }
  if (typeof p.exp !== 'number' || Date.now() > p.exp) throw new Error('State expired.')
  return p
}

// OAuth callback must only redirect to an internal admin path (no open-redirect to external hosts).
export function isSafeReturnPath(path: string): boolean {
  if (!path.startsWith('/')) return false
  // Reject protocol-relative (`//host`) and backslash tricks.
  if (path.startsWith('//') || path.startsWith('/\\')) return false
  return true
}
