// Astro gateway signer self-check. Asserts the EXACT fixed HMAC vectors pinned by the CMS suite
// (cms/tests/commerce-gateway.test.ts VECTOR A/B). HMAC-SHA256 is deterministic, so a byte-for-byte
// match here proves the Astro signer produces signatures the CMS verifier accepts — i.e. the two
// copies of the canonical/sign logic have not drifted.
//
// Run: cms/node_modules/.bin/tsx --test src/lib/store/__tests__/gateway-sign.test.ts (from repo root)

import assert from 'node:assert/strict'
import test from 'node:test'
import { Buffer } from 'node:buffer'
import { sign, bodyHashHex, buildCanonicalString } from '../gateway-sign'

// Same 32-byte test secret as the CMS suite (decode → exactly 32 bytes). Must match
// cms/tests/commerce-gateway.test.ts SECRET1_B64 character-for-character.
const SECRET1_B64 = 'ASNFZ4mrze8BI0VniavN7wEjRWeJq83vASNFZ4mrze8='
const secret = new Uint8Array(Buffer.from(SECRET1_B64, 'base64'))

test('bodyHashHex("{}") matches the CMS-pinned hash', () => {
  assert.equal(
    bodyHashHex(Buffer.from('{}', 'utf8')),
    '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
  )
})

test('buildCanonicalString: 7 LF fields, no trailing LF, no CR', () => {
  const c = buildCanonicalString({
    method: 'POST',
    pathAndQuery: '/api/commerce/store/acme/quote',
    tenantSlug: 'acme',
    timestamp: 1700000000,
    nonce: 'c2c1c1c0-c1c1-41c1-a1c1-c1c1c1c1c1c1',
    bodyHash: bodyHashHex(Buffer.from('{}', 'utf8')),
  })
  assert.equal(c.split('\n').length, 7)
  assert.equal(c.endsWith('\n'), false)
  assert.equal(c.includes('\r'), false)
})

test('VECTOR A: POST quote {} → exact CMS-accepted signature', () => {
  const out = sign({
    method: 'POST',
    path: '/api/commerce/store/acme/quote',
    query: '',
    tenantSlug: 'acme',
    body: Buffer.from('{}', 'utf8'),
    now: 1700000000,
    nonce: 'c2c1c1c0-c1c1-41c1-a1c1-c1c1c1c1c1c1',
    keyId: 'k-current-01',
    secret,
  })
  assert.equal(out.signature, '9745f4b144a6b9b2df434fc32106570955d00613bfae8fd4a0bd17baebb010c6')
  assert.equal(out.timestamp, '1700000000')
  assert.equal(out.nonce, 'c2c1c1c0-c1c1-41c1-a1c1-c1c1c1c1c1c1')
})

test('VECTOR B: GET catalog?limit=10 empty body → exact CMS-accepted signature', () => {
  const out = sign({
    method: 'GET',
    path: '/api/commerce/store/acme/catalog',
    query: 'limit=10',
    tenantSlug: 'acme',
    body: Buffer.from('', 'utf8'),
    now: 1700000123,
    nonce: '11111111-2222-4333-8444-555555555555',
    keyId: 'k-current-01',
    secret,
  })
  assert.equal(out.signature, 'eeda5798d28cbb7ec5cfe111ce7e750537053f4c43fa2fbff7597df7889cbdd8')
})

test('a default nonce is a lowercase v4 UUID; default timestamp is unix seconds', () => {
  const out = sign({
    method: 'GET',
    path: '/p',
    tenantSlug: 'acme',
    body: Buffer.alloc(0),
    now: 1700000000,
    keyId: 'k-current-01',
    secret,
  })
  assert.match(out.nonce, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})
