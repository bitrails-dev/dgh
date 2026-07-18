// Gift-card code hashing (Plan §3.10).
//
// Gift-card lookup = HMAC-SHA256(COMMERCE_GIFT_CARD_PEPPER, normalizedRawCode). Show the raw code
// ONCE at issuance; never store or log it. The pepper is read from COMMERCE_GIFT_CARD_PEPPER at
// call time (rotation is an operational concern; on rotation, all existing codeHash rows must be
// re-hashed with the new pepper — out of scope for v1).
//
// The pepper must be at least 32 random bytes when base64-decoded, matching the gateway-secret
// policy. The caller (issuance + lookup) passes the base64 pepper; this module enforces the
// minimum length and returns the hex HMAC.

import { createHmac, randomBytes } from 'node:crypto'

export const GIFT_CARD_PEPPER_ENV = 'COMMERCE_GIFT_CARD_PEPPER'

export class GiftCardPepperError extends Error {}

const MIN_PEPPER_BYTES = 32

// Normalize the raw code: trim, uppercase, strip whitespace + dashes. Must match between issuance
// and lookup so a customer typing "abcd-1234" vs "ABCD1234" hits the same row. Dashes are display-
// only delimiters; they are not part of the canonical code. Exported so unit tests can lock the
// canonicalization.
export function normalizeGiftCardCode(raw: string): string {
  return String(raw)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '')
}

// Decode a base64-encoded pepper into raw bytes. Throws GiftCardPepperError if missing or shorter
// than 32 bytes. We copy into a standalone Uint8Array so the caller cannot accidentally mutate a
// shared Buffer pool.
export function decodeGiftCardPepper(base64: string): Uint8Array {
  let buf: Buffer
  try {
    buf = Buffer.from(base64, 'base64')
  } catch {
    throw new GiftCardPepperError('COMMERCE_GIFT_CARD_PEPPER is not valid base64.')
  }
  if (buf.length < MIN_PEPPER_BYTES) {
    throw new GiftCardPepperError(
      `COMMERCE_GIFT_CARD_PEPPER must decode to at least ${MIN_PEPPER_BYTES} bytes (got ${buf.length}).`,
    )
  }
  return new Uint8Array(buf)
}

// Resolve the pepper from the environment at call time. Throws when unset/malformed.
export function resolveGiftCardPepper(env: NodeJS.ProcessEnv = process.env): Uint8Array {
  const b64 = env[GIFT_CARD_PEPPER_ENV]
  if (!b64) throw new GiftCardPepperError(`${GIFT_CARD_PEPPER_ENV} is not set.`)
  return decodeGiftCardPepper(b64)
}

// HMAC-SHA256(pepper, normalizedRawCode) → lowercase hex. The hex form is what is stored in
// `gift-cards.codeHash` and queried at checkout. Pepper may be passed as Uint8Array or base64
// string; both forms are accepted so unit tests can pass a fixed buffer while production code
// resolves from env.
export function hashGiftCardCode(
  rawCode: string,
  pepper: Uint8Array | string,
): string {
  const keyBytes = typeof pepper === 'string' ? decodeGiftCardPepper(pepper) : pepper
  if (keyBytes.length < MIN_PEPPER_BYTES) {
    throw new GiftCardPepperError(
      `Gift-card pepper must be at least ${MIN_PEPPER_BYTES} bytes (got ${keyBytes.length}).`,
    )
  }
  const normalized = normalizeGiftCardCode(rawCode)
  const h = createHmac('sha256', Buffer.from(keyBytes))
  h.update(normalized, 'utf8')
  return h.digest('hex')
}

// Generate a new raw gift-card code + its hash + the last-four support identifier. The code is a
// 24-character uppercase base32-style alphabet (no easily-confused 0/O or 1/I) grouped into 4-char
// blocks with dashes for human typing. Exported so the issuance flow (policy module) calls this and
// returns the raw code ONCE to the caller; only the hash is persisted.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O, 1/I

export function generateGiftCardCode(length = 24): string {
  if (!Number.isInteger(length) || length < 8) {
    throw new Error(`generateGiftCardCode length must be an integer >= 8, got ${length}`)
  }
  const bytes = randomBytes(length)
  const chars: string[] = []
  for (let i = 0; i < length; i++) {
    chars.push(CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length])
  }
  // Group into 4-char blocks separated by dashes for readability.
  return chars.join('').replace(/(.{4})(?=.)/g, '$1-')
}

// The "last four" support identifier is the last 4 non-delimiter chars of the raw code.
export function giftCardLastFour(rawCode: string): string {
  const clean = normalizeGiftCardCode(rawCode)
  return clean.slice(-4)
}
