// Task D/E crypto core: AES-256-GCM token encryption + HMAC-signed OAuth state. Node stdlib only.
// Pure functions — no DB, no provider — so every property is asserted deterministically here.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  encryptToken,
  decryptToken,
  signState,
  verifyState,
  isSafeReturnPath,
} from '../src/social/crypto'

const SECRET = 'test-secret-do-not-use-in-prod'

// --- Token encryption (AES-256-GCM, versioned key derived from the secret) -----------------

test('encryptToken/decryptToken round-trip', () => {
  const blob = encryptToken('{"access_token":"abc"}', SECRET)
  assert.equal(typeof blob, 'string')
  assert.equal(decryptToken(blob, SECRET), '{"access_token":"abc"}')
})

test('ciphertext is never plaintext; output is base64', () => {
  const blob = encryptToken('supersecret', SECRET)
  assert.ok(!blob.includes('supersecret'))
  assert.doesNotThrow(() => Buffer.from(blob, 'base64'))
})

test('each encryption uses a fresh IV (non-deterministic ciphertext)', () => {
  const a = encryptToken('x', SECRET)
  const b = encryptToken('x', SECRET)
  assert.notEqual(a, b)
  // ...but both decrypt to the same plaintext.
  assert.equal(decryptToken(a, SECRET), decryptToken(b, SECRET))
})

test('tampering with the ciphertext fails closed (auth tag mismatch)', () => {
  const blob = encryptToken('payload', SECRET)
  const buf = Buffer.from(blob, 'base64')
  // Flip the last ciphertext byte.
  buf[buf.length - 1] ^= 0x01
  assert.throws(() => decryptToken(buf.toString('base64'), SECRET))
})

test('decrypting with the wrong secret fails closed', () => {
  const blob = encryptToken('payload', SECRET)
  assert.throws(() => decryptToken(blob, 'a-different-secret'))
})

test('a blob with an unsupported key version is rejected', () => {
  const buf = Buffer.from(encryptToken('x', SECRET), 'base64')
  buf[0] = 99 // unknown version byte
  assert.throws(() => decryptToken(buf.toString('base64'), SECRET), /version/i)
})

// --- OAuth state (HMAC-signed, expiring) ---------------------------------------------------

const state = (overrides: Record<string, unknown> = {}) => ({
  tenantId: '7',
  platform: 'facebook',
  nonce: 'n-123',
  exp: Date.now() + 60_000,
  returnTo: '/admin/collections/tenants/7',
  ...overrides,
})

test('signState/verifyState round-trip', () => {
  const token = signState(state(), SECRET)
  const parsed = verifyState(token, SECRET)
  assert.equal(parsed.tenantId, '7')
  assert.equal(parsed.platform, 'facebook')
  assert.equal(parsed.nonce, 'n-123')
})

test('verifyState rejects a bad signature (forged or wrong secret)', () => {
  const token = signState(state(), SECRET)
  assert.throws(() => verifyState(token, 'wrong-secret'), /signature/i)
  // Tamper with the body but keep the (now mismatched) mac.
  const [body, mac] = token.split('.')
  const tampered = `${body.slice(0, -2)}xx.${mac}`
  assert.throws(() => verifyState(tampered, SECRET))
})

test('verifyState rejects an expired state', () => {
  const token = signState(state({ exp: Date.now() - 1 }), SECRET)
  assert.throws(() => verifyState(token, SECRET), /expir/i)
})

test('verifyState rejects malformed tokens', () => {
  assert.throws(() => verifyState('not-a-token', SECRET))
  assert.throws(() => verifyState('onlyonepart', SECRET))
})

// --- Redirect safety -----------------------------------------------------------------------

test('isSafeReturnPath accepts internal admin paths and rejects external/protocol-relative', () => {
  assert.equal(isSafeReturnPath('/admin/collections/tenants/7'), true)
  assert.equal(isSafeReturnPath('/admin'), true)
  assert.equal(isSafeReturnPath('//evil.com/admin'), false)
  assert.equal(isSafeReturnPath('https://evil.com/admin'), false)
  assert.equal(isSafeReturnPath(''), false)
  assert.equal(isSafeReturnPath('/\\evil.com'), false)
})
