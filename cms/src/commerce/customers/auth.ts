// Customer authentication core. Node `crypto` stdlib only — no Payload, no DB, no schema.
//
// Five pure responsibilities, each independently testable:
//   1. Password hashing with `scrypt` (versioned blob) + constant-time verify that fails closed.
//   2. Session tokens: random base64url token, sha256 of the token is the ONLY thing persisted.
//   3. Numeric OTPs via `crypto.randomInt` (uniform — no modulo bias, no Math.random).
//   4. Identity normalization for email and E.164-ish phone (return `null` on junk, never throw).
//   5. Pure attempt-window limiting where `now` is an input the caller controls (testable, fakeable).
//
// Plaintext passwords and hashes are never logged. Verify returns a boolean and never leaks whether
// the failure was a malformed record vs. a wrong password — both simply return `false`.

import {
  createHash,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'

// --- Password hashing (scrypt, versioned) -------------------------------------------------

const PASSWORD_VERSION = 1
const SALT_LEN = 16
const KEY_LEN = 32 // scrypt output length (256-bit derived key)
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } // OWASP-grade; ~16 MiB memory, sub-100ms on commodity hardware.

export type PasswordHash = { v: number; salt: string; hash: string }

export function hashPassword(password: string): PasswordHash {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('hashPassword requires a non-empty password string.')
  }
  const salt = randomBytes(SALT_LEN)
  const hash = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS)
  return { v: PASSWORD_VERSION, salt: salt.toString('base64'), hash: hash.toString('base64') }
}

// Fail closed: any malformed record, unknown version, or wrong password returns `false` without
// throwing. `timingSafeEqual` would throw on a length mismatch, so the KEY_LEN guard runs first;
// the scrypt derivation still runs for well-formed records so right/wrong-password timing is uniform.
export function verifyPassword(password: string, stored: PasswordHash | string | unknown): boolean {
  const rec = coerceRecord(stored)
  if (rec === null) return false
  if (rec.v !== PASSWORD_VERSION) return false
  let saltBuf: Buffer
  let expected: Buffer
  try {
    saltBuf = Buffer.from(rec.salt, 'base64')
    expected = Buffer.from(rec.hash, 'base64')
  } catch {
    return false
  }
  if (saltBuf.length === 0 || expected.length !== KEY_LEN) return false
  const derived = scryptSync(password, saltBuf, KEY_LEN, SCRYPT_PARAMS)
  return timingSafeEqual(derived, expected)
}

function coerceRecord(stored: unknown): Omit<PasswordHash, never> | null {
  if (stored == null) return null
  let rec: unknown = stored
  if (typeof stored === 'string') {
    try {
      rec = JSON.parse(stored)
    } catch {
      return null
    }
  }
  if (typeof rec !== 'object' || rec === null) return null
  const r = rec as Record<string, unknown>
  if (typeof r.v !== 'number' || typeof r.salt !== 'string' || typeof r.hash !== 'string') return null
  return { v: r.v, salt: r.salt, hash: r.hash }
}

// --- Session tokens -----------------------------------------------------------------------

// A session token is 256 bits of randomness encoded base64url. Only the sha256 hash is persisted;
// the raw token is handed to the client once and compared by re-hashing on lookup.
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  if (typeof token !== 'string') {
    throw new Error('hashToken requires a string token.')
  }
  return createHash('sha256').update(token).digest('hex')
}

export function verifyToken(token: string, storedHash: string): boolean {
  if (typeof token !== 'string' || typeof storedHash !== 'string') return false
  if (token.length === 0 || storedHash.length === 0) return false
  const derived = Buffer.from(hashToken(token), 'hex')
  const expected = Buffer.from(storedHash, 'hex')
  // Length guard prevents timingSafeEqual from throwing on malformed/short hex.
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}

// --- OTP ----------------------------------------------------------------------------------

export function generateNumericOtp(length = 6): string {
  if (!Number.isInteger(length) || length < 1) {
    throw new Error(`generateNumericOtp length must be a positive integer, got ${length}.`)
  }
  // `randomInt(0, 10)` samples uniformly over [0, 10) — no modulo bias, no Math.random.
  let otp = ''
  for (let i = 0; i < length; i++) otp += randomInt(0, 10).toString()
  return otp
}

// Constant-time string equality for short fixed-width secrets (OTPs). Length mismatch returns
// `false` (which leaks the length, acceptable for fixed-width OTPs); empty inputs fail closed.
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length === 0 || ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

// --- Identity normalization ---------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const trimmed = s.trim().toLowerCase()
  if (!EMAIL_RE.test(trimmed)) return null
  return trimmed
}

// E.164-ish: keep a leading `+` if present, drop every other non-digit, then require a plausible
// length. E.164 numbers are at most 15 digits; we require at least 6 to reject obviously short junk.
const PHONE_MIN = 6
const PHONE_MAX = 15

export function normalizePhoneE164(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const hadPlus = s.trim().startsWith('+')
  const digits = s.replace(/\D/g, '')
  if (!/^\d+$/.test(digits)) return null
  if (digits.length < PHONE_MIN || digits.length > PHONE_MAX) return null
  return hadPlus ? `+${digits}` : digits
}

// --- Attempt limiting (pure; `now` is an input) -------------------------------------------

export type AttemptState = { attempts: number; firstAttemptAtMs: number | null }

export type LockInput = {
  attempts: number
  max: number
  windowMs: number
  firstAttemptAtMs: number | null
  now: number
}

// Returns `true` once `attempts` has reached `max` AND the burst is still inside its window.
// Outside the window the burst is considered expired and the caller should reset — so this returns
// `false` (not locked) even with a high attempt count, signalling the window has rolled over.
export function shouldLock(input: LockInput): boolean {
  if (input.attempts < input.max) return false
  if (input.firstAttemptAtMs === null) return false
  return input.now - input.firstAttemptAtMs < input.windowMs
}

// Pure helper that advances an attempt state. If no window is open yet, or the prior window has
// elapsed, a fresh window starts at `now` with a count of 1; otherwise the in-window count grows.
export function recordAttempt(state: AttemptState, now: number, windowMs: number): AttemptState {
  if (state.firstAttemptAtMs === null || now - state.firstAttemptAtMs >= windowMs) {
    return { attempts: 1, firstAttemptAtMs: now }
  }
  return { attempts: state.attempts + 1, firstAttemptAtMs: state.firstAttemptAtMs }
}
