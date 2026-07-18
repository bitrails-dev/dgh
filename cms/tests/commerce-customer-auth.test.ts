// Customer auth core: scrypt password hashing, session tokens, OTP, identity normalization, and
// pure attempt limiting. Node stdlib only. Pure functions — no DB, no Payload — so every property
// is asserted deterministically here.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  constantTimeEqual,
  generateNumericOtp,
  generateSessionToken,
  hashPassword,
  hashToken,
  normalizeEmail,
  normalizePhoneE164,
  recordAttempt,
  shouldLock,
  verifyPassword,
  verifyToken,
  type AttemptState,
} from '../src/commerce/customers/auth'

// --- Password hashing (scrypt, versioned; fail-closed verify) ------------------------------

test('hashPassword/verifyPassword round-trip', () => {
  const stored = hashPassword('correct horse battery staple')
  assert.equal(stored.v, 1)
  assert.equal(typeof stored.salt, 'string')
  assert.equal(typeof stored.hash, 'string')
  assert.ok(stored.salt.length > 0)
  assert.ok(stored.hash.length > 0)
  assert.equal(verifyPassword('correct horse battery staple', stored), true)
})

test('a wrong password verifies false', () => {
  const stored = hashPassword('hunter2')
  assert.equal(verifyPassword('Hunter3', stored), false)
  assert.equal(verifyPassword('', stored), false)
})

test('each hash uses a fresh salt (non-deterministic hash output)', () => {
  const a = hashPassword('same')
  const b = hashPassword('same')
  assert.notEqual(a.salt, b.salt)
  assert.notEqual(a.hash, b.hash)
  // ...but both verify the same plaintext.
  assert.equal(verifyPassword('same', a), true)
  assert.equal(verifyPassword('same', b), true)
})

test('verifyPassword never throws on malformed/unknown-version records (fail closed)', () => {
  const good = hashPassword('pw')
  // Unknown version.
  assert.equal(verifyPassword('pw', { ...good, v: 99 }), false)
  // Missing fields / wrong shapes.
  assert.equal(verifyPassword('pw', {}), false)
  assert.equal(verifyPassword('pw', null), false)
  assert.equal(verifyPassword('pw', undefined), false)
  assert.equal(verifyPassword('pw', 'not-json'), false)
  assert.equal(verifyPassword('pw', 12345), false)
  // Well-formed v1 record but bad base64 / wrong hash length.
  assert.equal(verifyPassword('pw', { v: 1, salt: '!!!', hash: 'short' }), false)
  // A JSON string of a valid record still verifies.
  assert.equal(verifyPassword('pw', JSON.stringify(good)), true)
  // Hash output is never the plaintext.
  assert.ok(!good.hash.includes('pw'))
})

// --- Session tokens -----------------------------------------------------------------------

test('generateSessionToken is 32 random bytes, base64url, and unique', () => {
  const a = generateSessionToken()
  const b = generateSessionToken()
  assert.equal(Buffer.from(a, 'base64url').length, 32)
  assert.equal(Buffer.from(b, 'base64url').length, 32)
  assert.notEqual(a, b)
  assert.match(a, /^[A-Za-z0-9_-]+$/) // base64url alphabet, no padding
})

test('hashToken is a sha256 hex digest and differs from the token', () => {
  const token = generateSessionToken()
  const h = hashToken(token)
  assert.match(h, /^[0-9a-f]{64}$/)
  assert.ok(!h.includes(token))
  assert.notEqual(hashToken('a'), hashToken('b'))
})

test('verifyToken is true for the matching hash and false otherwise', () => {
  const token = generateSessionToken()
  const stored = hashToken(token)
  assert.equal(verifyToken(token, stored), true)
  assert.equal(verifyToken('some-other-token', stored), false)
  // Malformed stored hash / inputs fail closed without throwing.
  assert.equal(verifyToken(token, 'not-a-hex-hash'), false)
  assert.equal(verifyToken('', stored), false)
  assert.equal(verifyToken(token, ''), false)
})

// --- OTP ----------------------------------------------------------------------------------

test('generateNumericOtp defaults to 6, is all digits, and respects length', () => {
  const otp = generateNumericOtp()
  assert.match(otp, /^\d{6}$/)
  const eight = generateNumericOtp(8)
  assert.match(eight, /^\d{8}$/)
  assert.throws(() => generateNumericOtp(0))
  assert.throws(() => generateNumericOtp(-1))
  assert.throws(() => generateNumericOtp(2.5))
})

test('OTP draws cover every digit (loose uniformity via crypto.randomInt, no Math.random)', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 500; i++) {
    const otp = generateNumericOtp(6)
    for (const ch of otp) seen.add(ch)
  }
  // Over 3000 digits, every digit 0-9 should appear (vanishingly unlikely otherwise).
  assert.equal(seen.size, 10)
})

test('constantTimeEqual: equal true, different false, length mismatch false, empty fail closed', () => {
  const otp = generateNumericOtp(6)
  assert.equal(constantTimeEqual(otp, otp), true)
  assert.equal(constantTimeEqual('123456', '123456'), true)
  assert.equal(constantTimeEqual('123456', '123457'), false)
  assert.equal(constantTimeEqual('123456', '12345'), false) // length mismatch
  assert.equal(constantTimeEqual('', ''), false) // empty fails closed
  assert.equal(constantTimeEqual('123456', ''), false)
})

// --- Identity normalization ---------------------------------------------------------------

test('normalizeEmail trims, lowercases, and rejects junk', () => {
  assert.equal(normalizeEmail('  Patient@Hospital.ORG  '), 'patient@hospital.org')
  assert.equal(normalizeEmail('a.b+c@example.co.uk'), 'a.b+c@example.co.uk')
  assert.equal(normalizeEmail('not-an-email'), null)
  assert.equal(normalizeEmail('missing@domain'), null)
  assert.equal(normalizeEmail('@nodomain.com'), null)
  assert.equal(normalizeEmail('spaces @in.com'), null)
  assert.equal(normalizeEmail(''), null)
  assert.equal(normalizeEmail(null), null)
  assert.equal(normalizeEmail(42), null)
})

test('normalizePhoneE164 strips to digits, keeps a leading +, and bounds length', () => {
  assert.equal(normalizePhoneE164(' +20 (100) 123-4567 '), '+201001234567')
  assert.equal(normalizePhoneE164('01001234567'), '01001234567')
  assert.equal(normalizePhoneE164('  1-800-555-0142  '), '18005550142')
  // Too short to be a plausible phone.
  assert.equal(normalizePhoneE164('123'), null)
  // Too long for E.164 (>15 digits).
  assert.equal(normalizePhoneE164('1234567890123456'), null)
  // No digits at all.
  assert.equal(normalizePhoneE164('call me'), null)
  assert.equal(normalizePhoneE164(''), null)
  assert.equal(normalizePhoneE164(null), null)
})

// --- Attempt limiting (pure; `now` is an input) --------------------------------------------

test('shouldLock locks at max within the window and resets outside it', () => {
  const start = 10_000
  const windowMs = 60_000
  const max = 5
  // Below max → never locked, regardless of window.
  assert.equal(
    shouldLock({ attempts: 4, max, windowMs, firstAttemptAtMs: start, now: start + 10_000 }),
    false,
  )
  // At max, inside the window → locked.
  assert.equal(
    shouldLock({ attempts: 5, max, windowMs, firstAttemptAtMs: start, now: start + 30_000 }),
    true,
  )
  // At max, exactly at the window edge (>= windowMs) → reset, not locked.
  assert.equal(
    shouldLock({ attempts: 5, max, windowMs, firstAttemptAtMs: start, now: start + 60_000 }),
    false,
  )
  // At max, past the window → not locked (burst expired).
  assert.equal(
    shouldLock({ attempts: 99, max, windowMs, firstAttemptAtMs: start, now: start + 120_000 }),
    false,
  )
  // No first attempt recorded → not locked.
  assert.equal(
    shouldLock({ attempts: 5, max, windowMs, firstAttemptAtMs: null, now: start }),
    false,
  )
})

test('recordAttempt increments within the window and resets after it elapses', () => {
  const windowMs = 60_000
  const t0 = 1_000
  let state: AttemptState = { attempts: 0, firstAttemptAtMs: null }

  state = recordAttempt(state, t0, windowMs) // first attempt opens a window
  assert.deepEqual(state, { attempts: 1, firstAttemptAtMs: t0 })

  state = recordAttempt(state, t0 + 5_000, windowMs) // inside window → count up
  assert.deepEqual(state, { attempts: 2, firstAttemptAtMs: t0 })

  state = recordAttempt(state, t0 + 10_000, windowMs) // still inside
  assert.deepEqual(state, { attempts: 3, firstAttemptAtMs: t0 })

  // After the window elapses, a new attempt opens a fresh window at the new `now`.
  const t1 = t0 + 70_000
  state = recordAttempt(state, t1, windowMs)
  assert.deepEqual(state, { attempts: 1, firstAttemptAtMs: t1 })

  // Lock kicks in exactly when attempts reach max within the fresh window.
  const max = 3
  let s: AttemptState = { attempts: 0, firstAttemptAtMs: null }
  for (let i = 1; i <= max; i++) s = recordAttempt(s, t1 + i, windowMs)
  assert.equal(s.attempts, max)
  assert.equal(shouldLock({ ...s, max, windowMs, now: t1 + max }), true)
})
