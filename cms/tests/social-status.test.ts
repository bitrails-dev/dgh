// Task 6: the tenant social-status endpoint derives every platform's label + availability from the
// single platform catalogue — no duplicated label map. Asserts all 8 platforms appear exactly once.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Endpoint } from 'payload'
import { Tenants } from '../src/collections/Tenants'
import { ALL_PLATFORMS, platformLabel } from '../src/social/platforms'

const endpoints = (Tenants.endpoints ?? []) as Omit<Endpoint, 'root'>[]
const status = endpoints.find((e) => e.path === '/:id/social-status')!

const fakeReq = (user: unknown) => ({
  user,
  routeParams: { id: '7' },
  payload: { async find() { return { docs: [] } } },
}) as never

test('social-status returns every catalogue platform exactly once, with label + availability', async () => {
  const r = await status.handler(fakeReq({ roles: ['super-admin'] })) as Response
  assert.equal(r.status, 200)
  const body = await r.json() as { platforms: Array<{ platform: string; label: string; available: boolean; approvalNote: string }> }
  assert.equal(body.platforms.length, ALL_PLATFORMS.length)
  // each catalogue platform appears exactly once
  for (const p of ALL_PLATFORMS) {
    const matches = body.platforms.filter((x) => x.platform === p)
    assert.equal(matches.length, 1, `${p} must appear exactly once`)
    assert.equal(matches[0].label, platformLabel(p, 'en'), `${p} label must come from the catalogue`)
  }
  // tier-1 connectable platforms are `available`; tier-2 carry an approval note
  const tier2 = body.platforms.filter((p) => !p.available)
  assert.ok(tier2.length > 0)
  for (const p of tier2) assert.ok(p.approvalNote.length > 0, `${p.platform} needs an approval note`)
})

test('social-status rejects unauthorized users with 403', async () => {
  const r = await status.handler(fakeReq({ roles: ['editor'], tenants: [{ tenant: 99 }] })) as Response
  assert.equal(r.status, 403)
})
