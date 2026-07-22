import assert from 'node:assert/strict'
import test from 'node:test'

// Key derivation reads PAYLOAD_SECRET at call time; set a stable secret before exercising the API.
// Secret must be >= 32 bytes — the fail-closed guard in social/crypto `requirePayloadSecret`
// throws otherwise (NH6).
process.env.PAYLOAD_SECRET = 'commerce-crypto-test-secret-at-least-32-bytes'

import { decryptGatewaySecret, encryptGatewaySecret } from '../src/commerce/crypto'
import { decryptToken, encryptToken } from '../src/social/crypto'

test('gateway secrets round-trip through AES-256-GCM', () => {
  const secret = 'sk_live_paymob_0123456789_secret_key_value'
  const blob = encryptGatewaySecret(secret)
  assert.notEqual(blob, secret, 'plaintext must not appear in the blob')
  assert.equal(decryptGatewaySecret(blob), secret)
})

test('commerce keys are isolated from social keys: a commerce blob cannot be decrypted as social', () => {
  const blob = encryptGatewaySecret('k')
  assert.throws(() => decryptToken(blob, undefined, 'payload-social'), /auth tag|Unsupported|Malformed/)
})

test('social token crypto is unchanged (default purpose) — backward compatibility', () => {
  const blob = encryptToken('social-access-token')
  assert.equal(decryptToken(blob), 'social-access-token')
})

test('tampered blob fails closed', () => {
  const blob = encryptGatewaySecret('value')
  const tampered = blob.slice(0, -4) + 'AAAA'
  assert.throws(() => decryptGatewaySecret(tampered))
})
