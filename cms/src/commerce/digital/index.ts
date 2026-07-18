// Digital-entitlement signed download URLs. Node `crypto` stdlib only — no dependencies.
//
// Digital products grant short-lived signed download URLs. The storage path is NEVER exposed to
// clients: the URL carries an opaque file id + expiry + an HMAC-SHA256 signature over (id, expires)
// keyed by a server secret. The storage path is resolved server-side from the id only AFTER the
// signature verifies and the expiry checks out — a client-supplied path is never trusted.
//
// Mirrors the style of social/crypto.ts: pure functions, constant-time HMAC compare, and no
// Date.now in the verify path (the caller passes `now` so expiry is deterministic in tests).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// --- Signed download URL -------------------------------------------------------------------

// sig = HMAC_SHA256(secret, "${fileId}.${expires}") as lowercase hex. `base` is an optional prefix
// (path or origin); it is never signed, only prepended so callers can host under a CDN path.
export function signDownloadUrl(input: {
  fileId: string
  expiresAtMs: number
  secret: string
  base?: string
}): string {
  const { fileId, expiresAtMs, secret, base = '' } = input
  const sig = createHmac('sha256', secret).update(`${fileId}.${expiresAtMs}`).digest('hex')
  return `${base}/${fileId}?expires=${expiresAtMs}&sig=${sig}`
}

export type VerifyResult =
  | { ok: true; fileId: string }
  | { ok: false; code: 'malformed' | 'expired' | 'bad_sig' }

// Order matters for security: parse (malformed) → recompute & compare HMAC (bad_sig) → expiry
// (expired). The signature is verified BEFORE the expiry so a tampered expires is reported as
// bad_sig, not expired — an attacker cannot learn anything by fiddling with the expiry field.
export function verifyDownloadUrl(input: {
  url: string
  secret: string
  now: number
}): VerifyResult {
  const { url, secret, now } = input

  const qIndex = url.indexOf('?')
  if (qIndex === -1) return { ok: false, code: 'malformed' }
  const pathPart = url.slice(0, qIndex)
  const slash = pathPart.lastIndexOf('/')
  if (slash === -1) return { ok: false, code: 'malformed' }
  const fileId = pathPart.slice(slash + 1)
  if (!fileId) return { ok: false, code: 'malformed' }

  const params = new URLSearchParams(url.slice(qIndex + 1))
  const expiresStr = params.get('expires')
  const sig = params.get('sig')
  // Missing fields or non-integer expires → malformed. Digits-only rejects floats/signs/junk and
  // pins the HMAC input to exactly what the signer produced (no canonical-form ambiguity).
  if (expiresStr === null || sig === null || !/^\d+$/.test(expiresStr)) {
    return { ok: false, code: 'malformed' }
  }

  // Constant-time compare; length guard prevents timingSafeEqual from throwing on mismatched lengths.
  const expected = createHmac('sha256', secret).update(`${fileId}.${expiresStr}`).digest()
  const got = Buffer.from(sig, 'hex')
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return { ok: false, code: 'bad_sig' }
  }

  // `now >= expires` is "expired" — the boundary itself is rejected (no off-by-one grace window).
  const expires = Number(expiresStr)
  if (now >= expires) return { ok: false, code: 'expired' }

  return { ok: true, fileId }
}

// --- Storage path resolution ---------------------------------------------------------------

// Server-side id→path lookup, run only after verifyDownloadUrl succeeds. Returns null for unknown
// ids; a client-supplied path is never consulted, so the URL cannot be coerced into reading an
// arbitrary file.
export function resolveStoragePath(input: {
  fileId: string
  mapping: Record<string, string>
}): string | null {
  return input.mapping[input.fileId] ?? null
}

// --- File id generation --------------------------------------------------------------------

// 16 random bytes → 22-char base64url id. url-safe (no '+' or '/') for use in paths/query strings.
export function generateFileId(): string {
  return randomBytes(16).toString('base64url')
}
