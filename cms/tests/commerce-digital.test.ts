// Digital-entitlement signed download URLs: sign/verify round-trip, tamper rejection, expiry,
// malformed inputs, storage path resolution, and file id generation. Node stdlib only — pure
// functions, so every property is asserted deterministically here.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  signDownloadUrl,
  verifyDownloadUrl,
  resolveStoragePath,
  generateFileId,
} from '../src/commerce/digital'

const SECRET = 'test-secret-do-not-use-in-prod'
// Far-future expiry so non-expiry cases don't trip the gate; tests that care pass `now` explicitly.
const FAR = 10_000_000_000_000

// --- sign/verify round-trip ----------------------------------------------------------------

test('signDownloadUrl/verifyDownloadUrl round-trip returns the fileId', () => {
  const url = signDownloadUrl({ fileId: 'file-abc', expiresAtMs: FAR, secret: SECRET })
  assert.deepEqual(verifyDownloadUrl({ url, secret: SECRET, now: 0 }), {
    ok: true,
    fileId: 'file-abc',
  })
})

test('the signed url never exposes the storage path', () => {
  const url = signDownloadUrl({ fileId: 'file-abc', expiresAtMs: FAR, secret: SECRET })
  assert.ok(!url.includes('storage'))
  assert.ok(!url.includes('.pdf'))
  assert.ok(url.includes('file-abc'))
  assert.ok(url.includes('sig='))
})

test('base prefix is honoured and still verifies', () => {
  const url = signDownloadUrl({
    fileId: 'file-abc',
    expiresAtMs: FAR,
    secret: SECRET,
    base: 'https://cdn.example.com/dl',
  })
  assert.ok(url.startsWith('https://cdn.example.com/dl/file-abc?'))
  assert.deepEqual(verifyDownloadUrl({ url, secret: SECRET, now: 0 }), {
    ok: true,
    fileId: 'file-abc',
  })
})

// --- Tamper rejection (signature checked before expiry) ------------------------------------

const good = () => signDownloadUrl({ fileId: 'file-abc', expiresAtMs: FAR, secret: SECRET })

test('tampering the fileId is rejected as bad_sig', () => {
  const tampered = good().replace('/file-abc?', '/file-xyz?')
  assert.deepEqual(verifyDownloadUrl({ url: tampered, secret: SECRET, now: 0 }), {
    ok: false,
    code: 'bad_sig',
  })
})

test('tampering expires is rejected as bad_sig (not expired)', () => {
  // Push expiry into the far future but keep the original (now mismatched) sig.
  const tampered = good().replace('expires=10000000000000', 'expires=90000000000000')
  assert.deepEqual(verifyDownloadUrl({ url: tampered, secret: SECRET, now: 0 }), {
    ok: false,
    code: 'bad_sig',
  })
})

test('tampering the signature is rejected as bad_sig', () => {
  const tampered = good().replace(/sig=[0-9a-f]+/, `sig=${'0'.repeat(64)}`)
  assert.deepEqual(verifyDownloadUrl({ url: tampered, secret: SECRET, now: 0 }), {
    ok: false,
    code: 'bad_sig',
  })
})

test('a wrong secret is rejected as bad_sig', () => {
  assert.deepEqual(verifyDownloadUrl({ url: good(), secret: 'a-different-secret', now: 0 }), {
    ok: false,
    code: 'bad_sig',
  })
})

// --- Expiry --------------------------------------------------------------------------------

test('an expired url is rejected as expired (now >= expires)', () => {
  const url = signDownloadUrl({ fileId: 'file-abc', expiresAtMs: 1_000, secret: SECRET })
  // Boundary: now === expires is already expired.
  assert.deepEqual(verifyDownloadUrl({ url, secret: SECRET, now: 1_000 }), {
    ok: false,
    code: 'expired',
  })
  // One tick past expiry.
  assert.deepEqual(verifyDownloadUrl({ url, secret: SECRET, now: 1_001 }), {
    ok: false,
    code: 'expired',
  })
})

test('expiry boundary: now < expires is accepted', () => {
  const url = signDownloadUrl({ fileId: 'file-abc', expiresAtMs: 1_000, secret: SECRET })
  assert.deepEqual(verifyDownloadUrl({ url, secret: SECRET, now: 999 }), {
    ok: true,
    fileId: 'file-abc',
  })
})

// --- Malformed -----------------------------------------------------------------------------

test('missing signature is malformed', () => {
  assert.deepEqual(verifyDownloadUrl({ url: '/file-abc?expires=10000000000000', secret: SECRET, now: 0 }), {
    ok: false,
    code: 'malformed',
  })
})

test('missing expires is malformed', () => {
  assert.deepEqual(
    verifyDownloadUrl({ url: `/file-abc?sig=${'0'.repeat(64)}`, secret: SECRET, now: 0 }),
    { ok: false, code: 'malformed' },
  )
})

test('non-numeric expires is malformed', () => {
  assert.deepEqual(
    verifyDownloadUrl({ url: `/file-abc?expires=not-a-number&sig=${'0'.repeat(64)}`, secret: SECRET, now: 0 }),
    { ok: false, code: 'malformed' },
  )
})

test('a negative expires is malformed (digits-only)', () => {
  assert.deepEqual(
    verifyDownloadUrl({ url: `/file-abc?expires=-1000&sig=${'0'.repeat(64)}`, secret: SECRET, now: 0 }),
    { ok: false, code: 'malformed' },
  )
})

test('missing query string is malformed', () => {
  assert.deepEqual(verifyDownloadUrl({ url: '/file-abc', secret: SECRET, now: 0 }), {
    ok: false,
    code: 'malformed',
  })
})

test('path with no fileId segment is malformed', () => {
  assert.deepEqual(
    verifyDownloadUrl({ url: `/?expires=10000000000000&sig=${'0'.repeat(64)}`, secret: SECRET, now: 0 }),
    { ok: false, code: 'malformed' },
  )
})

// --- Storage path resolution ---------------------------------------------------------------

test('resolveStoragePath returns the mapped path for a known id', () => {
  // After NM12, paths are relative (resolved against a configured storage root by the caller);
  // absolute paths and `..` traversal are rejected as defense-in-depth.
  const mapping = { 'file-abc': 'private/file-abc.pdf' }
  assert.equal(resolveStoragePath({ fileId: 'file-abc', mapping }), 'private/file-abc.pdf')
})

test('resolveStoragePath returns null for an unknown id (never trusts a client path)', () => {
  const mapping = { 'file-abc': 'private/file-abc.pdf' }
  assert.equal(resolveStoragePath({ fileId: 'file-xyz', mapping }), null)
  assert.equal(resolveStoragePath({ fileId: 'file-xyz', mapping: {} }), null)
})

test('resolveStoragePath rejects traversal and absolute paths (NM12 defense-in-depth)', () => {
  assert.equal(
    resolveStoragePath({ fileId: 'a', mapping: { a: '/etc/passwd' } }),
    null,
    'leading-slash absolute path rejected',
  )
  assert.equal(
    resolveStoragePath({ fileId: 'a', mapping: { a: '../escape.pdf' } }),
    null,
    'parent-dir traversal rejected',
  )
  assert.equal(
    resolveStoragePath({ fileId: 'a', mapping: { a: 'safe/../../escape.pdf' } }),
    null,
    'mid-path traversal rejected',
  )
  assert.equal(
    resolveStoragePath({ fileId: 'a', mapping: { a: 'safe/file.pdf' } }),
    'safe/file.pdf',
    'normal relative path passes',
  )
})

// --- File id generation --------------------------------------------------------------------

test('generateFileId is url-safe and unique over several draws', () => {
  const ids = new Set<string>()
  for (let i = 0; i < 64; i++) {
    const id = generateFileId()
    ids.add(id)
    // base64url alphabet only: A–Z a–z 0–9 - _. No '+' or '/' that would break a path/query.
    assert.match(id, /^[A-Za-z0-9_-]+$/)
  }
  // 16 bytes of entropy → collisions across 64 draws are astronomically unlikely.
  assert.equal(ids.size, 64)
})
