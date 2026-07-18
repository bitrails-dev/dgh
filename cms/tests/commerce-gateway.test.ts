// Gateway boundary unit tests. Pure crypto + an in-memory nonce ledger — no network, no Payload
// boot. Asserts the exact §4.1 canonical string, fixed HMAC test vectors (HMAC is deterministic, so
// the literal hex is asserted), every §4.1 rejection case, rotation, and the reject-before-parse
// contract.
//
// Run: npx tsx --test tests/commerce-gateway.test.ts (from cms/)

import assert from 'node:assert/strict'
import test from 'node:test'
import { Buffer } from 'node:buffer'
import {
  GATEWAY_HEADER_NAMES,
  InMemoryNonceRepo,
  buildCanonicalPathAndQuery,
  buildCanonicalString,
  bodyHashHex,
  decodeGatewaySecret,
  nonceHash,
  resolveKeysFromEnv,
  sign,
  verify,
  type KeyMaterial,
  type VerifyResult,
  type SignInput,
} from '../src/commerce/gateway'

// --- Fixed key material -------------------------------------------------------------
// 32 random bytes, base64. SECRET1 / SECRET2 are independent (the plan forbids reusing
// PAYLOAD_SECRET or provider secrets — these are test-only and decoded to exactly 32 bytes).
const SECRET1_B64 = 'ASNFZ4mrze8BI0VniavN7wEjRWeJq83vASNFZ4mrze8='
const SECRET2_B64 = '/ty6mHZUMhD+3LqYdlQyEP7cuph2VDIQ/ty6mHZUMhA='
const KEY_CURRENT: KeyMaterial = { keyId: 'k-current-01', secret: decodeGatewaySecret(SECRET1_B64) }
const KEY_PREVIOUS: KeyMaterial = {
  keyId: 'k-previous-01',
  secret: decodeGatewaySecret(SECRET2_B64),
}

// Fixed "server now" for deterministic timestamp-window assertions.
const NOW = 1_700_000_500

// --- Canonical string builder -------------------------------------------------------

test('buildCanonicalString matches §4.1 byte-for-byte: 7 LF-separated fields, no trailing LF', () => {
  const c = buildCanonicalString({
    method: 'POST',
    pathAndQuery: '/api/commerce/store/acme/quote',
    tenantSlug: 'acme',
    timestamp: 1700000000,
    nonce: 'c2c1c1c0-c1c1-41c1-a1c1-c1c1c1c1c1c1',
    bodyHash: bodyHashHex(Buffer.from('{}', 'utf8')),
  })
  assert.equal(
    c,
    [
      'v1',
      'POST',
      '/api/commerce/store/acme/quote',
      'acme',
      '1700000000',
      'c2c1c1c0-c1c1-41c1-a1c1-c1c1c1c1c1c1',
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    ].join('\n'),
  )
  assert.equal(c.endsWith('\n'), false, 'canonical string must NOT have a trailing LF')
  assert.equal(c.indexOf('\r'), -1, 'canonical string must NOT contain CR')
  assert.equal(c.split('\n').length, 7, 'canonical string must have exactly 7 fields')
})

test('buildCanonicalString uppercases method and lowercases tenant/nonce/bodyHash', () => {
  const c = buildCanonicalString({
    method: 'post',
    pathAndQuery: '/p',
    tenantSlug: 'ACME',
    timestamp: 1,
    nonce: 'C2C1C1C0-C1C1-41C1-A1C1-C1C1C1C1C1C1',
    bodyHash: 'ABCD'.repeat(16),
  })
  const lines = c.split('\n')
  assert.equal(lines[1], 'POST')
  assert.equal(lines[3], 'acme')
  assert.equal(lines[5], 'c2c1c1c0-c1c1-41c1-a1c1-c1c1c1c1c1c1')
  assert.equal(lines[6], 'abcd'.repeat(16))
})

test('buildCanonicalPathAndQuery: undefined/empty query → path only; non-empty → path?query', () => {
  assert.equal(buildCanonicalPathAndQuery('/p', undefined), '/p')
  assert.equal(buildCanonicalPathAndQuery('/p', null), '/p')
  assert.equal(buildCanonicalPathAndQuery('/p', ''), '/p')
  assert.equal(buildCanonicalPathAndQuery('/p', 'a=1&b=2'), '/p?a=1&b=2')
})

// --- Fixed signature test vectors (HMAC is deterministic — assert the literal hex) ---

test('VECTOR A: POST quote with body "{}" → exact expected HMAC hex', () => {
  const out = sign({
    method: 'POST',
    path: '/api/commerce/store/acme/quote',
    query: '',
    tenantSlug: 'acme',
    body: Buffer.from('{}', 'utf8'),
    now: 1700000000,
    nonce: 'c2c1c1c0-c1c1-41c1-a1c1-c1c1c1c1c1c1',
    keyId: KEY_CURRENT.keyId,
    secret: KEY_CURRENT.secret,
  })
  assert.equal(out.signature, '9745f4b144a6b9b2df434fc32106570955d00613bfae8fd4a0bd17baebb010c6')
  assert.equal(out.timestamp, '1700000000')
  assert.equal(out.nonce, 'c2c1c1c0-c1c1-41c1-a1c1-c1c1c1c1c1c1')
  assert.equal(out.keyId, KEY_CURRENT.keyId)
  // Wire headers carry the four canonical names with the same values.
  assert.equal(out.headers[GATEWAY_HEADER_NAMES.keyId], KEY_CURRENT.keyId)
  assert.equal(out.headers[GATEWAY_HEADER_NAMES.timestamp], '1700000000')
  assert.equal(out.headers[GATEWAY_HEADER_NAMES.nonce], out.nonce)
  assert.equal(out.headers[GATEWAY_HEADER_NAMES.signature], out.signature)
  // Structured tuple matches.
  assert.deepEqual(out.structured, {
    keyId: KEY_CURRENT.keyId,
    timestamp: '1700000000',
    nonce: out.nonce,
    signature: out.signature,
  })
})

test('VECTOR B: GET catalog?limit=10 with empty body → exact expected HMAC hex', () => {
  const out = sign({
    method: 'GET',
    path: '/api/commerce/store/acme/catalog',
    query: 'limit=10',
    tenantSlug: 'acme',
    body: Buffer.from('', 'utf8'),
    now: 1700000123,
    nonce: '11111111-2222-4333-8444-555555555555',
    keyId: KEY_CURRENT.keyId,
    secret: KEY_CURRENT.secret,
  })
  assert.equal(out.signature, 'eeda5798d28cbb7ec5cfe111ce7e750537053f4c43fa2fbff7597df7889cbdd8')
})

// --- Round-trip: sign → verify is the happy path ------------------------------------

const BASE_SIGN: SignInput = {
  method: 'POST',
  path: '/api/commerce/store/acme/quote',
  query: '',
  tenantSlug: 'acme',
  body: Buffer.from('{}', 'utf8'),
  now: NOW,
  nonce: 'c2c1c1c0-c1c1-41c1-a1c1-c1c1c1c1c1c1',
  keyId: KEY_CURRENT.keyId,
  secret: KEY_CURRENT.secret,
}

async function verifySigned(
  signOverrides: Partial<SignInput> = {},
  verifyOverrides: Record<string, unknown> = {},
  headersOverrides: Record<string, string> = {},
  repo: InMemoryNonceRepo = new InMemoryNonceRepo(),
): Promise<VerifyResult> {
  const merged: SignInput = { ...BASE_SIGN, ...signOverrides }
  const out = sign(merged)
  const headers = { ...out.headers, ...headersOverrides }
  return verify({
    method: merged.method,
    path: merged.path,
    query: merged.query,
    tenantSlug: merged.tenantSlug,
    bodyBytes: merged.body,
    headers,
    currentKeys: [KEY_CURRENT],
    now: NOW,
    nonceRepo: repo,
    ...verifyOverrides,
  })
}

test('happy path: a valid signature verifies ok and echoes the tenant slug', async () => {
  const r = await verifySigned()
  assert.deepEqual(r, { ok: true, tenantSlug: 'acme' })
})

test('header lookup is case-insensitive (Payload/Node headers normalize to lowercase)', async () => {
  const out = sign(BASE_SIGN)
  // Lowercase the header keys the way Node's incoming message headers do.
  const lowerHeaders: Record<string, string> = {}
  for (const [k, v] of Object.entries(out.headers)) lowerHeaders[k.toLowerCase()] = v
  const r = await verify({
    method: BASE_SIGN.method,
    path: BASE_SIGN.path!,
    query: BASE_SIGN.query,
    tenantSlug: BASE_SIGN.tenantSlug,
    bodyBytes: BASE_SIGN.body,
    headers: lowerHeaders,
    currentKeys: [KEY_CURRENT],
    now: NOW,
    nonceRepo: new InMemoryNonceRepo(),
  })
  assert.deepEqual(r, { ok: true, tenantSlug: 'acme' })
})

// --- Rejection cases (one per reason) ----------------------------------------------

test('rejects with missing_header when any of the four headers is absent', async () => {
  for (const drop of Object.values(GATEWAY_HEADER_NAMES)) {
    const out = sign(BASE_SIGN)
    const headers = { ...out.headers }
    delete headers[drop]
    const r = await verify({
      method: BASE_SIGN.method,
      path: BASE_SIGN.path!,
      query: BASE_SIGN.query,
      tenantSlug: BASE_SIGN.tenantSlug,
      bodyBytes: BASE_SIGN.body,
      headers,
      currentKeys: [KEY_CURRENT],
      now: NOW,
      nonceRepo: new InMemoryNonceRepo(),
    })
    assert.equal(r.ok, false, `expected rejection when ${drop} is missing`)
    if (!r.ok) assert.equal(r.reason, 'missing_header')
  }
})

test('rejects with unknown_key_id when the key id matches no candidate', async () => {
  const r = await verifySigned(
    { keyId: 'k-current-01', secret: KEY_CURRENT.secret },
    {},
    { [GATEWAY_HEADER_NAMES.keyId]: 'k-bogus-00' },
  )
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'unknown_key_id')
})

test('rejects with malformed_timestamp on non-decimal timestamp', async () => {
  // Empty string is treated as a missing header (it is falsy in getHeader); every other value here
  // is non-empty and reaches the decimal-format check.
  for (const bad of ['abc', '1.5', '1700000000.0', '-1', '0x10', ' ']) {
    const r = await verifySigned({}, {}, { [GATEWAY_HEADER_NAMES.timestamp]: bad })
    assert.equal(r.ok, false, `expected rejection for timestamp=${JSON.stringify(bad)}`)
    if (!r.ok) assert.equal(r.reason, 'malformed_timestamp')
  }
})

test('an empty timestamp header value is treated as missing (it is falsy in getHeader)', async () => {
  const r = await verifySigned({}, {}, { [GATEWAY_HEADER_NAMES.timestamp]: '' })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'missing_header')
})

test('timestamp boundary: ±300s accepted; ±301s rejected as timestamp_out_of_range', async () => {
  // Boundary inclusive.
  for (const offset of [-300, 0, 300]) {
    const r = await verifySigned({ now: NOW + offset })
    assert.equal(r.ok, true, `expected ok at offset=${offset}`)
  }
  // Just outside the window.
  for (const offset of [-301, 301]) {
    const r = await verifySigned({ now: NOW + offset })
    assert.equal(r.ok, false, `expected rejection at offset=${offset}`)
    if (!r.ok) assert.equal(r.reason, 'timestamp_out_of_range')
  }
})

test('expired and far-future timestamps are rejected (covered by the boundary test)', async () => {
  // A 1-hour-old signature is well outside ±300s.
  const r = await verifySigned({ now: NOW - 3600 })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'timestamp_out_of_range')
})

test('rejects with malformed_nonce on non-v4-UUID nonce', async () => {
  // The signer always produces a valid signature with BASE_SIGN's nonce; we then override ONLY the
  // nonce header to the bad value. The verifier rejects at nonce-format (step 5) before signature
  // comparison, so the signature value is irrelevant here.
  const badNonces = [
    'c2c1c1c0-c1c1-31c1-a1c1-c1c1c1c1c1c1', // wrong version nibble (3 not 4)
    'c2c1c1c0-c1c1-41c1-c1c1-c1c1c1c1c1c1', // wrong variant (c not in 8/9/a/b)
    'C2C1C1C0-C1C1-41C1-A1C1-C1C1C1C1C1C1', // uppercase — canonical form is lowercase
    'not-a-uuid', // wrong shape
    'c2c1c1c0-c1c1-41c1-a1c1', // truncated
  ]
  for (const bad of badNonces) {
    const r = await verifySigned({}, {}, { [GATEWAY_HEADER_NAMES.nonce]: bad })
    assert.equal(r.ok, false, `expected rejection for nonce=${bad}`)
    if (!r.ok) assert.equal(r.reason, 'malformed_nonce')
  }
})

test('rejects with malformed_signature on 63/65/uppercase/non-hex signature', async () => {
  const good = sign(BASE_SIGN).signature
  // 63 chars (drop one).
  const s63 = good.slice(0, 63)
  // 65 chars (add one).
  const s65 = good + 'a'
  // Uppercase — canonical form is lowercase only.
  const sUpper = good.toUpperCase()
  // Non-hex.
  const sNonHex = 'z'.repeat(64)
  for (const bad of [s63, s65, sUpper, sNonHex]) {
    const r = await verifySigned({}, {}, { [GATEWAY_HEADER_NAMES.signature]: bad })
    assert.equal(r.ok, false, `expected rejection for signature length=${bad.length}`)
    if (!r.ok) assert.equal(r.reason, 'malformed_signature')
  }
})

test('rejects with signature_mismatch when the body bytes are tampered after signing', async () => {
  // Sign over `{}`, then verify receives `{"a":1}`.
  const out = sign(BASE_SIGN)
  const r = await verify({
    method: BASE_SIGN.method,
    path: BASE_SIGN.path!,
    query: BASE_SIGN.query,
    tenantSlug: BASE_SIGN.tenantSlug,
    bodyBytes: Buffer.from('{"a":1}', 'utf8'),
    headers: out.headers,
    currentKeys: [KEY_CURRENT],
    now: NOW,
    nonceRepo: new InMemoryNonceRepo(),
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'signature_mismatch')
})

test('rejects with signature_mismatch on method/path/query/tenantSlug mismatch', async () => {
  const cases: Array<{ name: string; verify: Record<string, unknown> }> = [
    { name: 'method', verify: { method: 'GET' } },
    { name: 'path', verify: { path: '/api/commerce/store/acme/cart' } },
    { name: 'query', verify: { query: 'changed=1' } },
    { name: 'tenantSlug', verify: { tenantSlug: 'beta' } },
  ]
  for (const c of cases) {
    const r = await verifySigned({}, c.verify)
    assert.equal(r.ok, false, `expected rejection for ${c.name} mismatch`)
    if (!r.ok) assert.equal(r.reason, 'signature_mismatch')
  }
})

test('rejects with replay when the same signed request is verified twice against one ledger', async () => {
  const repo = new InMemoryNonceRepo()
  const out = sign(BASE_SIGN)
  const common = {
    method: BASE_SIGN.method,
    path: BASE_SIGN.path!,
    query: BASE_SIGN.query,
    tenantSlug: BASE_SIGN.tenantSlug,
    bodyBytes: BASE_SIGN.body,
    headers: out.headers,
    currentKeys: [KEY_CURRENT] as KeyMaterial[],
    now: NOW,
  }
  const first = await verify({ ...common, nonceRepo: repo })
  assert.equal(first.ok, true)
  assert.equal(repo.size, 1, 'nonce ledger should hold exactly one row after the first verify')

  const second = await verify({ ...common, nonceRepo: repo })
  assert.equal(second.ok, false)
  if (!second.ok) assert.equal(second.reason, 'replay')
  // A replay must NOT grow the ledger.
  assert.equal(repo.size, 1)
})

// --- Rotation -----------------------------------------------------------------------

test('rotation: a request signed with the previous key verifies when previousKeys is supplied', async () => {
  const out = sign({ ...BASE_SIGN, keyId: KEY_PREVIOUS.keyId, secret: KEY_PREVIOUS.secret })
  const r = await verify({
    method: BASE_SIGN.method,
    path: BASE_SIGN.path!,
    query: BASE_SIGN.query,
    tenantSlug: BASE_SIGN.tenantSlug,
    bodyBytes: BASE_SIGN.body,
    headers: out.headers,
    currentKeys: [KEY_CURRENT],
    previousKeys: [KEY_PREVIOUS],
    now: NOW,
    nonceRepo: new InMemoryNonceRepo(),
  })
  assert.deepEqual(r, { ok: true, tenantSlug: 'acme' })
})

test('rotation: after the previous pair is removed, the same request is rejected as unknown_key_id', async () => {
  const out = sign({ ...BASE_SIGN, keyId: KEY_PREVIOUS.keyId, secret: KEY_PREVIOUS.secret })
  const r = await verify({
    method: BASE_SIGN.method,
    path: BASE_SIGN.path!,
    query: BASE_SIGN.query,
    tenantSlug: BASE_SIGN.tenantSlug,
    bodyBytes: BASE_SIGN.body,
    headers: out.headers,
    currentKeys: [KEY_CURRENT],
    // previousKeys omitted (rotation complete).
    now: NOW,
    nonceRepo: new InMemoryNonceRepo(),
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'unknown_key_id')
})

test('rotation: previousKey half-specified in env throws GatewayKeyError', () => {
  // Only one of PREVIOUS_KEY_ID / PREVIOUS_SECRET set is an error.
  assert.throws(
    () =>
      resolveKeysFromEnv({
        COMMERCE_GATEWAY_KEY_ID: KEY_CURRENT.keyId,
        COMMERCE_GATEWAY_SECRET: SECRET1_B64,
        COMMERCE_GATEWAY_PREVIOUS_KEY_ID: KEY_PREVIOUS.keyId,
        // PREVIOUS_SECRET intentionally omitted.
      }),
    /PREVIOUS/,
  )
})

// --- Reject-before-parse: JSON is never parsed before verification ------------------

test('verifier accepts bytes that are NOT valid JSON when the signature matches those bytes', async () => {
  // Sign over an arbitrary byte string that is not valid JSON.
  const body = Buffer.from('{not json', 'utf8')
  const out = sign({ ...BASE_SIGN, body })
  const r = await verify({
    method: BASE_SIGN.method,
    path: BASE_SIGN.path!,
    query: BASE_SIGN.query,
    tenantSlug: BASE_SIGN.tenantSlug,
    bodyBytes: body,
    headers: out.headers,
    currentKeys: [KEY_CURRENT],
    now: NOW,
    nonceRepo: new InMemoryNonceRepo(),
  })
  // Verifier does not care that this is invalid JSON — it only hashes bytes.
  assert.deepEqual(r, { ok: true, tenantSlug: 'acme' })
})

test('verifier rejects on byte mutation even when the mutated bytes happen to be valid JSON', async () => {
  // Sign over invalid bytes; verify receives different (valid JSON) bytes. The signature must NOT
  // match, proving the verifier gates on bytes — not on a JSON-level field comparison.
  const signedBytes = Buffer.from('{not json', 'utf8')
  const out = sign({ ...BASE_SIGN, body: signedBytes })
  const r = await verify({
    method: BASE_SIGN.method,
    path: BASE_SIGN.path!,
    query: BASE_SIGN.query,
    tenantSlug: BASE_SIGN.tenantSlug,
    bodyBytes: Buffer.from('{"ok":true}', 'utf8'),
    headers: out.headers,
    currentKeys: [KEY_CURRENT],
    now: NOW,
    nonceRepo: new InMemoryNonceRepo(),
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'signature_mismatch')
})

// --- Keys / decoding guards ---------------------------------------------------------

test('decodeGatewaySecret rejects secrets that decode to fewer than 32 bytes', () => {
  // 16 bytes — too short.
  const shortB64 = Buffer.from('0123456789abcdef', 'utf8').toString('base64')
  assert.throws(() => decodeGatewaySecret(shortB64), /at least 32 bytes/)
})

test('decodeGatewaySecret accepts exactly 32 bytes', () => {
  const secret = decodeGatewaySecret(SECRET1_B64)
  assert.equal(secret.length, 32)
})

test('resolveKeysFromEnv reads the current pair and throws when missing', () => {
  const r = resolveKeysFromEnv({
    COMMERCE_GATEWAY_KEY_ID: KEY_CURRENT.keyId,
    COMMERCE_GATEWAY_SECRET: SECRET1_B64,
  })
  assert.equal(r.current.keyId, KEY_CURRENT.keyId)
  assert.equal(r.previous, undefined)

  assert.throws(
    () => resolveKeysFromEnv({ COMMERCE_GATEWAY_KEY_ID: KEY_CURRENT.keyId }),
    /COMMERCE_GATEWAY_SECRET/,
  )
  assert.throws(() => resolveKeysFromEnv({}), /COMMERCE_GATEWAY_KEY_ID/)
})

test('resolveKeysFromEnv resolves both current and previous when both pairs are set', () => {
  const r = resolveKeysFromEnv({
    COMMERCE_GATEWAY_KEY_ID: KEY_CURRENT.keyId,
    COMMERCE_GATEWAY_SECRET: SECRET1_B64,
    COMMERCE_GATEWAY_PREVIOUS_KEY_ID: KEY_PREVIOUS.keyId,
    COMMERCE_GATEWAY_PREVIOUS_SECRET: SECRET2_B64,
  })
  assert.equal(r.current.keyId, KEY_CURRENT.keyId)
  assert.equal(r.previous?.keyId, KEY_PREVIOUS.keyId)
})

// --- nonceHash sanity ---------------------------------------------------------------

test('nonceHash is a 64-char lowercase hex SHA-256 of the nonce', () => {
  const h = nonceHash('c2c1c1c0-c1c1-41c1-a1c1-c1c1c1c1c1c1')
  assert.match(h, /^[0-9a-f]{64}$/)
  // Deterministic.
  assert.equal(h, nonceHash('c2c1c1c0-c1c1-41c1-a1c1-c1c1c1c1c1c1'))
})
